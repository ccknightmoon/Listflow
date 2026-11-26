// Permanent draft delete: the row AND its photos in our storage, scoped to
// one seller. Server only.
//
// Before this, DELETE removed only the row (photos stayed in storage
// forever) and always answered "deleted" -- even when Postgres removed
// nothing (wrong id, RLS), so the app could believe a delete happened that
// didn't. Now the answer lists exactly which ids were removed.
//
// Photos: only paths inside this seller's own folders are removed (public
// "<userId>/..." and private "<userId>/..."), and never one still used by
// another of their drafts or by an unfinished listing job. Older shared
// "public/..." uploads are left alone (they predate per-user folders, so we
// can't prove they're unused by someone else).
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftUrls, removeStoragePaths, storagePath, PRIVATE_PATH_MARK } from "@/lib/photo-cleanup";

export interface DeletableDraft {
  id: string;
  photo_urls: string[] | null;
  thumbnail_url: string | null;
}

/** True when a storage path is in this seller's own folder (public or private bucket). */
export function ownedByUser(path: string, userId: string): boolean {
  const p = path.startsWith(PRIVATE_PATH_MARK) ? path.slice(PRIVATE_PATH_MARK.length) : path;
  return p.startsWith(`${userId}/`);
}

/**
 * Storage paths to purge for `targets`: ours, in the seller's folder, and
 * not referenced by anything in `keepUrls` (their other drafts, job inputs).
 */
export function photoPathsToPurge(targets: DeletableDraft[], keepUrls: string[], supabaseUrl: string, userId: string): { purge: string[]; kept: number } {
  const keep = new Set(keepUrls.map((u) => storagePath(u, supabaseUrl)).filter((p): p is string => !!p));
  const all = new Set<string>();
  for (const t of targets) for (const u of draftUrls(t)) {
    const p = storagePath(u, supabaseUrl);
    if (p) all.add(p);
  }
  const purge = [...all].filter((p) => !keep.has(p) && ownedByUser(p, userId));
  return { purge, kept: all.size - purge.length };
}

/** Every photo-looking string inside a job's input JSON (urls or private refs). */
export function urlsInJson(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (/^(https?:\/\/|private:)/.test(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) urlsInJson(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) urlsInJson(v, out);
  }
  return out;
}

export interface DeleteResult {
  deleted: string[];
  notFound: string[];
  photosRemoved: number;
  photosKept: number;
}

/**
 * `db` is the signed-in seller's client (RLS); `storageDb` removes the
 * files (a service client: every path was already checked to be theirs).
 */
export async function deleteDraftsCompletely(db: SupabaseClient, storageDb: SupabaseClient, userId: string, ids: string[], supabaseUrl: string): Promise<DeleteResult> {
  const { data: targets, error: readErr } = await db
    .from("drafts")
    .select("id, photo_urls, thumbnail_url")
    .eq("user_id", userId)
    .in("id", ids);
  if (readErr) throw new Error(readErr.message);

  const { data: removed, error: delErr } = await db
    .from("drafts")
    .delete()
    .eq("user_id", userId)
    .in("id", ids)
    .select("id");
  if (delErr) throw new Error(delErr.message);
  const deleted = (removed ?? []).map((r) => r.id as string);
  const deletedSet = new Set(deleted);
  const gone = ((targets ?? []) as DeletableDraft[]).filter((t) => deletedSet.has(t.id));

  let photosRemoved = 0;
  let photosKept = 0;
  if (gone.length) {
    // What must stay: photos on the seller's remaining drafts and in jobs
    // that haven't finished (a queued job may still create a draft from them).
    const { data: others } = await db.from("drafts").select("photo_urls, thumbnail_url").eq("user_id", userId);
    // listing_jobs is optional (migration 029); a read error just means no jobs.
    const { data: jobs } = await db.from("listing_jobs").select("input").eq("user_id", userId).in("status", ["queued", "running"]);
    // Recycle bin (migration 037): photos of drafts waiting there stay until it's purged.
    const { data: trash } = await db.from("draft_trash").select("photo_urls").eq("user_id", userId);
    const keepUrls = [
      ...((others ?? []) as Array<Pick<DeletableDraft, "photo_urls" | "thumbnail_url">>).flatMap((d) => draftUrls(d)),
      ...(jobs ?? []).flatMap((j) => urlsInJson((j as { input?: unknown }).input)),
      ...((trash ?? []) as Array<{ photo_urls?: unknown }>).flatMap((t) => (Array.isArray(t.photo_urls) ? (t.photo_urls as string[]) : [])),
    ];
    const { purge, kept } = photoPathsToPurge(gone, keepUrls, supabaseUrl, userId);
    photosKept = kept;
    if (purge.length) {
      try {
        photosRemoved = await removeStoragePaths(storageDb, purge);
        photosKept += purge.length - photosRemoved;
      } catch {
        photosKept += purge.length; // the draft is gone either way; orphan cleanup can retry
      }
    }
  }
  return { deleted, notFound: ids.filter((id) => !deletedSet.has(id)), photosRemoved, photosKept };
}
