// Frees Supabase Storage (1 GB on the free plan) without losing anything
// that matters. Server only.
//
// * Published drafts: N days after a successful eBay publish, the draft's
//   photo links are switched to eBay's own hosted copies (read from the
//   live listing with GetItem), then our copies are deleted. Relisting and
//   the app's thumbnails keep working from eBay's copies. If eBay's copies
//   can't be read, the draft is skipped (nothing deleted).
// * Unpublished drafts: never touched.
// * Orphans (optional, default off): photos no draft, no queued job and no
//   recycle-bin entry uses, older than 7 days -- in BOTH buckets (the
//   private bucket was added Nov 2026 and wasn't swept before).
// * Old shared folder photos/public/ (pre per-seller folders): only for the
//   seller named in PHOTO_LEGACY_OWNER_ID, only unused + 30+ days old.
// A photo still used by ANY other draft is never deleted.
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePrivatePhotoRef, PRIVATE_BUCKET } from "@/lib/private-photos";

export const ORPHAN_MIN_AGE_DAYS = 7;
const MAX_DRAFTS_PER_RUN = 25;
const BUCKET = "photos";

export interface CleanupSettings {
  enabled: boolean;
  days: number;
  orphans: boolean;
  lastRun: string | null;
}

export interface CleanupDraft {
  id: string;
  ebay_listing_id: string | null;
  ebay_listed_at: string | null;
  photo_urls: string[] | null;
  thumbnail_url: string | null;
}

/** Marks a path in the private bucket (private draft photos, see private-photos.ts). */
export const PRIVATE_PATH_MARK = "private:";

/**
 * "userId/file.jpg" for one of OUR public photo URLs, "private:userId/file.jpg"
 * for a private draft photo link, else null.
 */
export function storagePath(url: string | null | undefined, supabaseUrl: string): string | null {
  if (!url) return null;
  const priv = parsePrivatePhotoRef(url);
  if (priv) return PRIVATE_PATH_MARK + priv.path;
  try {
    const u = new URL(url);
    const base = new URL(supabaseUrl);
    const prefix = `/storage/v1/object/public/${BUCKET}/`;
    if (u.host !== base.host || !u.pathname.startsWith(prefix)) return null;
    return decodeURIComponent(u.pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

/** Removes paths from the right bucket(s); returns how many were removed. */
export async function removeStoragePaths(db: SupabaseClient, paths: string[]): Promise<number> {
  const pub = paths.filter((p) => !p.startsWith(PRIVATE_PATH_MARK));
  const priv = paths.filter((p) => p.startsWith(PRIVATE_PATH_MARK)).map((p) => p.slice(PRIVATE_PATH_MARK.length));
  let removed = 0;
  if (pub.length) {
    const { error } = await db.storage.from(BUCKET).remove(pub);
    if (!error) removed += pub.length;
  }
  if (priv.length) {
    const { error } = await db.storage.from(PRIVATE_BUCKET).remove(priv);
    if (!error) removed += priv.length;
  }
  return removed;
}

export function draftUrls(d: Pick<CleanupDraft, "photo_urls" | "thumbnail_url">): string[] {
  return [...(d.photo_urls ?? []), ...(d.thumbnail_url ? [d.thumbnail_url] : [])];
}

/** Published drafts old enough whose photos are still in our storage. */
export function publishedDue(drafts: CleanupDraft[], supabaseUrl: string, days: number, now: number): CleanupDraft[] {
  const cutoff = now - days * 86400_000;
  return drafts.filter(
    (d) =>
      !!d.ebay_listing_id &&
      !!d.ebay_listed_at &&
      Date.parse(d.ebay_listed_at) <= cutoff &&
      draftUrls(d).some((u) => storagePath(u, supabaseUrl))
  );
}

/** Paths safe to delete for `target`: ours, and not used by any other draft. */
export function deletablePaths(target: CleanupDraft, others: CleanupDraft[], supabaseUrl: string): string[] {
  const keep = new Set<string>();
  for (const o of others) {
    if (o.id === target.id) continue;
    for (const u of draftUrls(o)) {
      const p = storagePath(u, supabaseUrl);
      if (p) keep.add(p);
    }
  }
  const mine = new Set(draftUrls(target).map((u) => storagePath(u, supabaseUrl)).filter((p): p is string => !!p));
  return [...mine].filter((p) => !keep.has(p));
}

export interface CleanupDeps {
  db: SupabaseClient; // service role; every query is scoped to userId
  supabaseUrl: string;
  /** eBay-hosted picture URLs of a live listing ([] if unreadable). */
  ebayPictures(listingId: string): Promise<string[]>;
  now?: () => number;
}

export interface CleanupReport {
  draftsCleaned: number;
  photosDeleted: number;
  orphansDeleted: number;
  /** Old photos/public/ files removed (only for PHOTO_LEGACY_OWNER_ID). */
  legacyDeleted?: number;
  skipped: number;
  skippedReason?: string;
}

export async function readCleanupSettings(db: SupabaseClient, userId: string): Promise<CleanupSettings | null> {
  const { data, error } = await db
    .from("app_settings")
    .select("photo_cleanup_enabled, photo_cleanup_days, photo_cleanup_orphans, photo_cleanup_last_run")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null; // migration 030 not applied -> cleanup off
  return {
    enabled: data?.photo_cleanup_enabled ?? true,
    days: data?.photo_cleanup_days ?? 3,
    orphans: data?.photo_cleanup_orphans ?? false,
    lastRun: data?.photo_cleanup_last_run ?? null,
  };
}

/** Runs at most once a day per seller (called from the app-open sweep). */
export async function runPhotoCleanup(deps: CleanupDeps, userId: string, opts: { force?: boolean } = {}): Promise<CleanupReport> {
  const now = (deps.now ?? Date.now)();
  const report: CleanupReport = { draftsCleaned: 0, photosDeleted: 0, orphansDeleted: 0, skipped: 0 };
  const settings = await readCleanupSettings(deps.db, userId);
  if (!settings) return { ...report, skippedReason: "migration 030 not applied" };
  if (!settings.enabled && !settings.orphans) return { ...report, skippedReason: "turned off" };
  if (!opts.force && settings.lastRun && now - Date.parse(settings.lastRun) < 20 * 3600_000) {
    return { ...report, skippedReason: "already ran today" };
  }
  // Claim today's run first so two app opens don't both run it.
  await deps.db.from("app_settings").update({ photo_cleanup_last_run: new Date(now).toISOString() }).eq("user_id", userId);

  const { data: rows, error } = await deps.db
    .from("drafts")
    .select("id, ebay_listing_id, ebay_listed_at, photo_urls, thumbnail_url")
    .eq("user_id", userId)
    .limit(10_000);
  if (error) return { ...report, skippedReason: error.message };
  let drafts = (rows ?? []) as CleanupDraft[];

  if (settings.enabled) {
    for (const d of publishedDue(drafts, deps.supabaseUrl, settings.days, now).slice(0, MAX_DRAFTS_PER_RUN)) {
      const pics = await deps.ebayPictures(d.ebay_listing_id!).catch(() => []);
      if (pics.length === 0) {
        report.skipped++;
        continue;
      }
      const paths = deletablePaths(d, drafts, deps.supabaseUrl);
      // Point the draft at eBay's copies first (only if it hasn't changed meanwhile).
      const { data: upd, error: uErr } = await deps.db
        .from("drafts")
        .update({ photo_urls: pics, thumbnail_url: pics[0] })
        .eq("id", d.id)
        .eq("user_id", userId)
        .not("ebay_listing_id", "is", null)
        .select("id");
      if (uErr || !upd?.length) {
        report.skipped++;
        continue;
      }
      drafts = drafts.map((x) => (x.id === d.id ? { ...x, photo_urls: pics, thumbnail_url: pics[0] } : x));
      if (paths.length) {
        report.photosDeleted += await removeStoragePaths(deps.db, paths);
      }
      report.draftsCleaned++;
    }
  }

  if (settings.orphans) report.orphansDeleted = await removeOrphans(deps, userId, drafts, now);
  if (settings.orphans && legacyOwner() === userId) {
    const l = await findLegacyOrphans(deps, now);
    let n = 0;
    for (let i = 0; i < l.paths.length; i += 100) n += await removeStoragePaths(deps.db, l.paths.slice(i, i + 100));
    report.legacyDeleted = n;
  }
  return report;
}

/** Every storage path this seller's drafts, queued jobs and recycle bin still use; null = unsure (delete nothing). */
async function pathsInUse(deps: CleanupDeps, userId: string, drafts: CleanupDraft[]): Promise<Set<string> | null> {
  const used = new Set<string>();
  for (const d of drafts) for (const u of draftUrls(d)) {
    const p = storagePath(u, deps.supabaseUrl);
    if (p) used.add(p);
  }
  // Photos waiting in the background queue (no draft yet) are in use too.
  const { data: jobs, error: jErr } = await deps.db
    .from("listing_jobs")
    .select("input")
    .eq("user_id", userId)
    .in("status", ["queued", "running", "dead"]);
  if (jErr && !/listing_jobs|does not exist|could not find/i.test(jErr.message)) return null;
  for (const j of jobs ?? []) {
    for (const u of ((j.input as { photoUrls?: string[] })?.photoUrls ?? [])) {
      const p = storagePath(u, deps.supabaseUrl);
      if (p) used.add(p);
    }
  }
  // Drafts in the recycle bin (migration 037) still own their photos.
  const { data: trash, error: tErr } = await deps.db.from("draft_trash").select("photo_urls").eq("user_id", userId);
  if (tErr && !/draft_trash|does not exist|could not find/i.test(tErr.message)) return null;
  for (const t of (trash ?? []) as Array<{ photo_urls?: unknown }>) {
    for (const u of Array.isArray(t.photo_urls) ? (t.photo_urls as string[]) : []) {
      const p = storagePath(u, deps.supabaseUrl);
      if (p) used.add(p);
    }
  }
  return used;
}

export interface OrphanScan {
  /** Paths to delete ("userId/x.jpg" public, "private:userId/x.jpg" private). */
  paths: string[];
  bytes: number;
  /** Why nothing could be scanned, if so. */
  error?: string;
}

/**
 * Orphans in BOTH buckets (Phase 1 fix: the private bucket was never swept),
 * in the seller's own folder: files no draft, queued job or recycle-bin
 * entry uses, older than ORPHAN_MIN_AGE_DAYS.
 */
export async function findOrphans(deps: CleanupDeps, userId: string, drafts: CleanupDraft[], now: number): Promise<OrphanScan> {
  const used = await pathsInUse(deps, userId, drafts);
  if (!used) return { paths: [], bytes: 0, error: "couldn't check which photos are in use" };
  const cutoff = now - ORPHAN_MIN_AGE_DAYS * 86400_000;
  const out: OrphanScan = { paths: [], bytes: 0 };
  for (const [bucket, mark] of [[BUCKET, ""], [PRIVATE_BUCKET, PRIVATE_PATH_MARK]] as const) {
    for (let offset = 0; offset < 20_000; offset += 1000) {
      const { data, error } = await deps.db.storage.from(bucket).list(userId, { limit: 1000, offset, sortBy: { column: "created_at", order: "asc" } });
      if (error) {
        // A missing private bucket just means private photos were never used.
        if (bucket === PRIVATE_BUCKET) break;
        return { paths: [], bytes: 0, error: `listing ${bucket}: ${error.message}` };
      }
      for (const f of data ?? []) {
        const path = `${mark}${userId}/${f.name}`;
        const created = Date.parse(f.created_at ?? "");
        if (f.id && Number.isFinite(created) && created <= cutoff && !used.has(path)) {
          out.paths.push(path);
          out.bytes += Number((f.metadata as { size?: number } | null)?.size ?? 0) || 0;
        }
      }
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

async function removeOrphans(deps: CleanupDeps, userId: string, drafts: CleanupDraft[], now: number): Promise<number> {
  const scan = await findOrphans(deps, userId, drafts, now);
  let removed = 0;
  for (let i = 0; i < scan.paths.length; i += 100) removed += await removeStoragePaths(deps.db, scan.paths.slice(i, i + 100));
  return removed;
}

// ------------------------------------------------------------------------
// Legacy folder (Phase 1 fix). Before per-seller folders, uploads went to
// photos/public/ (470 files, 214 MB live on Nov 26, 2026 -- 73% of storage
// and the main reason "650 photos for 8 drafts"). No sweep ever looked
// there. These belong to the single seller who used the app back then, so
// they're only swept when PHOTO_LEGACY_OWNER_ID is set to that seller's
// user id (unset = never touched), and only files that NO draft, recycle
// bin entry or queued job of ANY seller uses, older than 30 days.
export const LEGACY_FOLDER = "public";
export const LEGACY_MIN_AGE_DAYS = 30;

export function legacyOwner(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.PHOTO_LEGACY_OWNER_ID?.trim();
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

/** Every legacy path still referenced anywhere (all sellers); null = unsure. */
async function legacyPathsInUse(db: SupabaseClient, supabaseUrl: string): Promise<Set<string> | null> {
  const used = new Set<string>();
  const add = (u: unknown) => {
    if (typeof u !== "string") return;
    const p = storagePath(u, supabaseUrl);
    if (p && p.startsWith(`${LEGACY_FOLDER}/`)) used.add(p);
  };
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await db.from("drafts").select("photo_urls, thumbnail_url").range(from, from + 999);
    if (error) return null;
    for (const d of data ?? []) { (d.photo_urls as string[] | null)?.forEach(add); add(d.thumbnail_url); }
    if (!data || data.length < 1000) break;
  }
  const { data: trash, error: tErr } = await db.from("draft_trash").select("photo_urls");
  if (tErr && !/draft_trash|does not exist|could not find/i.test(tErr.message)) return null;
  for (const t of (trash ?? []) as Array<{ photo_urls?: unknown }>) if (Array.isArray(t.photo_urls)) t.photo_urls.forEach(add);
  const { data: jobs, error: jErr } = await db.from("listing_jobs").select("input").in("status", ["queued", "running", "dead"]);
  if (jErr && !/listing_jobs|does not exist|could not find/i.test(jErr.message)) return null;
  for (const j of jobs ?? []) ((j.input as { photoUrls?: unknown[] })?.photoUrls ?? []).forEach(add);
  return used;
}

export async function findLegacyOrphans(deps: CleanupDeps, now: number): Promise<OrphanScan> {
  const used = await legacyPathsInUse(deps.db, deps.supabaseUrl);
  if (!used) return { paths: [], bytes: 0, error: "couldn't check which old photos are in use" };
  const cutoff = now - LEGACY_MIN_AGE_DAYS * 86400_000;
  const out: OrphanScan = { paths: [], bytes: 0 };
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const { data, error } = await deps.db.storage.from(BUCKET).list(LEGACY_FOLDER, { limit: 1000, offset, sortBy: { column: "created_at", order: "asc" } });
    if (error) return { paths: [], bytes: 0, error: `listing old photos: ${error.message}` };
    for (const f of data ?? []) {
      const path = `${LEGACY_FOLDER}/${f.name}`;
      const created = Date.parse(f.created_at ?? "");
      if (f.id && Number.isFinite(created) && created <= cutoff && !used.has(path)) {
        out.paths.push(path);
        out.bytes += Number((f.metadata as { size?: number } | null)?.size ?? 0) || 0;
      }
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

export interface StoragePreview {
  orphans: { files: number; mb: number; error?: string };
  legacy: { files: number; mb: number; enabled: boolean; error?: string } | null;
}

const mb = (b: number) => Math.round((b / 1048576) * 10) / 10;

/** What a cleanup would delete right now. Read-only. */
export async function previewCleanup(deps: CleanupDeps, userId: string): Promise<StoragePreview> {
  const now = (deps.now ?? Date.now)();
  const { data: rows } = await deps.db.from("drafts").select("id, ebay_listing_id, ebay_listed_at, photo_urls, thumbnail_url").eq("user_id", userId).limit(10_000);
  const o = await findOrphans(deps, userId, (rows ?? []) as CleanupDraft[], now);
  const isOwner = legacyOwner() === userId;
  let legacy: StoragePreview["legacy"] = null;
  if (isOwner) {
    const l = await findLegacyOrphans(deps, now);
    legacy = { files: l.paths.length, mb: mb(l.bytes), enabled: true, error: l.error };
  }
  return { orphans: { files: o.paths.length, mb: mb(o.bytes), error: o.error }, legacy };
}

/** Picture URLs of a live listing, from eBay GetItem (eBay-hosted copies). */
export function parsePictureUrls(xml: string): string[] {
  const block = xml.match(/<PictureDetails>([\s\S]*?)<\/PictureDetails>/)?.[1] ?? "";
  return [...block.matchAll(/<PictureURL>([^<]+)<\/PictureURL>/g)].map((m) => m[1].trim()).filter((u) => /^https:\/\//.test(u));
}
