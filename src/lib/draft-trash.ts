// Recycle bin for drafts (Nov 2026). Server only.
//
// Deleting a draft now MOVES it to `draft_trash` (migration 037): the
// whole row is kept as JSON, the photos stay in storage, and the draft is
// removed from `drafts`. Because the row really leaves `drafts`, every
// list, count, cache and sync that reads `drafts` stops seeing it at once
// -- nothing has to remember to filter "deleted" rows.
//
// - Undo / Restore puts the row back (same id, so links and photos work).
// - After TRASH_DAYS the daily cron purges it for good: the trash row AND
//   the seller's own photos that nothing else still uses.
// - "Delete now" in the bin purges immediately.
// - Without migration 037 the old behaviour is kept (permanent delete).
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteDraftsCompletely, photoPathsToPurge, urlsInJson, type DeletableDraft, type DeleteResult } from "@/lib/draft-delete";
import { draftUrls, removeStoragePaths } from "@/lib/photo-cleanup";

export const TRASH_DAYS = 7;
export const TRASH_TABLE = "draft_trash";
const DAY_MS = 86_400_000;

export function purgeAfter(deletedAt: number, days = TRASH_DAYS): string {
  return new Date(deletedAt + days * DAY_MS).toISOString();
}

export function isMissingTrashTable(err: { code?: string; message?: string } | null | undefined): boolean {
  return !!err && (err.code === "42P01" || err.code === "PGRST205" || /draft_trash|relation .* does not exist|could not find the table/i.test(err.message ?? ""));
}

export interface TrashRow {
  id: string;
  user_id: string;
  row: Record<string, unknown>;
  photo_urls: string[];
  deleted_at: string;
  purge_after: string;
}

export interface TrashedItem {
  id: string;
  title: string | null;
  thumbnail: string | null;
  price: number | null;
  deletedAt: string;
  purgeAfter: string;
}

/** What the bin shows (never the full row). */
export function toTrashedItem(t: Pick<TrashRow, "id" | "row" | "deleted_at" | "purge_after">): TrashedItem {
  const r = t.row ?? {};
  const price = r.suggested_price == null ? null : Number(r.suggested_price);
  return {
    id: t.id,
    title: typeof r.title === "string" ? r.title : null,
    thumbnail: typeof r.thumbnail_url === "string" ? r.thumbnail_url : Array.isArray(r.photo_urls) && typeof r.photo_urls[0] === "string" ? (r.photo_urls[0] as string) : null,
    price: Number.isFinite(price) ? price : null,
    deletedAt: t.deleted_at,
    purgeAfter: t.purge_after,
  };
}

export interface TrashResult {
  /** "trash" = moved to the bin (undo possible); "permanent" = migration 037 missing, deleted for good. */
  mode: "trash" | "permanent";
  trashed: string[];
  notFound: string[];
  purgeAfter: string | null;
  permanent?: DeleteResult;
}

/**
 * Moves the seller's drafts to the bin. Order matters: the copy is written
 * to the bin first and the draft is only removed once that succeeded, so a
 * failure can never lose a draft (worst case it's in both places; restore
 * and purge both handle that).
 */
export async function trashDrafts(db: SupabaseClient, storageDb: SupabaseClient, userId: string, ids: string[], supabaseUrl: string, now = Date.now()): Promise<TrashResult> {
  const { data: rows, error: readErr } = await db.from("drafts").select("*").eq("user_id", userId).in("id", ids);
  if (readErr) throw new Error(readErr.message);
  const found = (rows ?? []) as Array<Record<string, unknown> & { id: string }>;
  const notFound = ids.filter((id) => !found.some((r) => r.id === id));
  if (!found.length) return { mode: "trash", trashed: [], notFound, purgeAfter: null };

  const deletedAt = new Date(now).toISOString();
  const after = purgeAfter(now);
  const trashRows = found.map((r) => ({
    id: r.id,
    user_id: userId,
    row: r,
    photo_urls: [...new Set(draftUrls(r as unknown as DeletableDraft))],
    deleted_at: deletedAt,
    purge_after: after,
  }));
  const { error: insErr } = await db.from(TRASH_TABLE).upsert(trashRows, { onConflict: "id" });
  if (insErr) {
    if (isMissingTrashTable(insErr)) {
      const permanent = await deleteDraftsCompletely(db, storageDb, userId, ids, supabaseUrl);
      return { mode: "permanent", trashed: permanent.deleted, notFound: permanent.notFound, purgeAfter: null, permanent };
    }
    throw new Error(insErr.message);
  }

  const { data: removed, error: delErr } = await db.from("drafts").delete().eq("user_id", userId).in("id", found.map((r) => r.id)).select("id");
  if (delErr) throw new Error(delErr.message);
  const trashed = (removed ?? []).map((r) => (r as { id: string }).id);
  return { mode: "trash", trashed, notFound: [...notFound, ...found.map((r) => r.id).filter((id) => !trashed.includes(id))], purgeAfter: after };
}

export async function listTrash(db: SupabaseClient, userId: string): Promise<{ items: TrashedItem[]; available: boolean }> {
  const { data, error } = await db.from(TRASH_TABLE).select("id, row, deleted_at, purge_after").eq("user_id", userId).order("deleted_at", { ascending: false }).limit(500);
  if (error) {
    if (isMissingTrashTable(error)) return { items: [], available: false };
    throw new Error(error.message);
  }
  return { items: ((data ?? []) as TrashRow[]).map(toTrashedItem), available: true };
}

export interface RestoreResult {
  restored: string[];
  notFound: string[];
  /** Restored without their SKU because another draft now uses it. */
  skuCleared: string[];
}

/** Columns never written back (server-managed). */
const RESTORE_DROP = new Set(["user_id"]);

export function restorableRow(row: Record<string, unknown>, userId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!RESTORE_DROP.has(k)) out[k] = v;
  out.user_id = userId; // always the owner, whatever the JSON says
  return out;
}

export async function restoreDrafts(db: SupabaseClient, userId: string, ids: string[]): Promise<RestoreResult> {
  const { data, error } = await db.from(TRASH_TABLE).select("id, row").eq("user_id", userId).in("id", ids);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<Pick<TrashRow, "id" | "row">>;
  const restored: string[] = [];
  const skuCleared: string[] = [];
  for (const t of rows) {
    const row = restorableRow(t.row, userId);
    // ignoreDuplicates: if the draft is somehow still there, keep it as is.
    let { error: insErr } = await db.from("drafts").upsert([row], { onConflict: "id", ignoreDuplicates: true });
    if (insErr && insErr.code === "23505" && /custom_sku/i.test(insErr.message ?? "")) {
      ({ error: insErr } = await db.from("drafts").upsert([{ ...row, custom_sku: null }], { onConflict: "id", ignoreDuplicates: true }));
      if (!insErr) skuCleared.push(t.id);
    }
    if (insErr) continue; // stays in the bin; nothing lost
    await db.from(TRASH_TABLE).delete().eq("user_id", userId).eq("id", t.id);
    restored.push(t.id);
  }
  return { restored, notFound: ids.filter((id) => !rows.some((r) => r.id === id)), skuCleared };
}

/**
 * Purges bin rows for good: the row and the seller's own photos that no
 * live draft, other bin item (not being purged) or unfinished job uses.
 * `db` must be able to read the seller's drafts/jobs (RLS client or service).
 */
export async function purgeTrashRows(db: SupabaseClient, storageDb: SupabaseClient, userId: string, targets: Array<Pick<TrashRow, "id" | "photo_urls">>, supabaseUrl: string): Promise<{ purged: string[]; photosRemoved: number; photosKept: number }> {
  if (!targets.length) return { purged: [], photosRemoved: 0, photosKept: 0 };
  const targetIds = new Set(targets.map((t) => t.id));
  const { data: drafts, error: dErr } = await db.from("drafts").select("photo_urls, thumbnail_url").eq("user_id", userId);
  if (dErr) throw new Error(dErr.message); // unsure what's in use -> delete nothing
  const { data: others } = await db.from(TRASH_TABLE).select("id, photo_urls").eq("user_id", userId);
  const { data: jobs } = await db.from("listing_jobs").select("input").eq("user_id", userId).in("status", ["queued", "running"]);
  const keepUrls = [
    ...((drafts ?? []) as Array<Pick<DeletableDraft, "photo_urls" | "thumbnail_url">>).flatMap((d) => draftUrls(d)),
    ...((others ?? []) as Array<Pick<TrashRow, "id" | "photo_urls">>).filter((o) => !targetIds.has(o.id)).flatMap((o) => o.photo_urls ?? []),
    ...(jobs ?? []).flatMap((j) => urlsInJson((j as { input?: unknown }).input)),
  ];
  const asDrafts: DeletableDraft[] = targets.map((t) => ({ id: t.id, photo_urls: t.photo_urls ?? [], thumbnail_url: null }));
  const { purge, kept } = photoPathsToPurge(asDrafts, keepUrls, supabaseUrl, userId);
  let photosRemoved = 0;
  let photosKept = kept;
  if (purge.length) {
    try {
      photosRemoved = await removeStoragePaths(storageDb, purge);
      photosKept += purge.length - photosRemoved;
    } catch {
      photosKept += purge.length;
    }
  }
  const { data: gone, error: delErr } = await db.from(TRASH_TABLE).delete().eq("user_id", userId).in("id", [...targetIds]).select("id");
  if (delErr) throw new Error(delErr.message);
  return { purged: (gone ?? []).map((g) => (g as { id: string }).id), photosRemoved, photosKept };
}

/** "Delete now" from the bin (the seller's own client). */
export async function purgeTrashNow(db: SupabaseClient, storageDb: SupabaseClient, userId: string, ids: string[], supabaseUrl: string) {
  const { data, error } = await db.from(TRASH_TABLE).select("id, photo_urls").eq("user_id", userId).in("id", ids);
  if (error) throw new Error(error.message);
  return purgeTrashRows(db, storageDb, userId, (data ?? []) as Array<Pick<TrashRow, "id" | "photo_urls">>, supabaseUrl);
}

/** Daily cron: everything past its purge date, every seller (service client). */
export async function purgeExpiredTrash(service: SupabaseClient, supabaseUrl: string, now = Date.now(), limit = 2000): Promise<{ sellers: number; purged: number; photosRemoved: number; skipped?: string; errors: number }> {
  const { data, error } = await service.from(TRASH_TABLE).select("id, user_id, photo_urls").lte("purge_after", new Date(now).toISOString()).limit(limit);
  if (error) {
    if (isMissingTrashTable(error)) return { sellers: 0, purged: 0, photosRemoved: 0, skipped: "migration 037 not applied", errors: 0 };
    throw new Error(error.message);
  }
  const byUser = new Map<string, Array<Pick<TrashRow, "id" | "photo_urls">>>();
  for (const r of (data ?? []) as Array<Pick<TrashRow, "id" | "user_id" | "photo_urls">>) {
    byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), { id: r.id, photo_urls: r.photo_urls }]);
  }
  let purged = 0;
  let photosRemoved = 0;
  let errors = 0;
  for (const [userId, rows] of byUser) {
    try {
      const r = await purgeTrashRows(service, service, userId, rows, supabaseUrl);
      purged += r.purged.length;
      photosRemoved += r.photosRemoved;
    } catch {
      errors++; // try again tomorrow; nothing removed for this seller
    }
  }
  return { sellers: byUser.size, purged, photosRemoved, errors };
}

/** Photo links held by a seller's bin (so other cleanups never delete them). */
export async function trashPhotoUrls(db: SupabaseClient, userId: string): Promise<string[] | null> {
  const { data, error } = await db.from(TRASH_TABLE).select("photo_urls").eq("user_id", userId);
  if (error) return isMissingTrashTable(error) ? [] : null;
  return ((data ?? []) as Array<{ photo_urls: string[] | null }>).flatMap((r) => r.photo_urls ?? []);
}
