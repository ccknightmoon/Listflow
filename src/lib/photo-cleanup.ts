// Frees Supabase Storage (1 GB on the free plan) without losing anything
// that matters. Server only.
//
// * Published drafts: N days after a successful eBay publish, the draft's
//   photo links are switched to eBay's own hosted copies (read from the
//   live listing with GetItem), then our copies are deleted. Relisting and
//   the app's thumbnails keep working from eBay's copies. If eBay's copies
//   can't be read, the draft is skipped (nothing deleted).
// * Unpublished drafts: never touched.
// * Orphans (optional, default off): photos no draft and no queued job
//   uses, older than 7 days.
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
  return report;
}

async function removeOrphans(deps: CleanupDeps, userId: string, drafts: CleanupDraft[], now: number): Promise<number> {
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
  if (jErr && !/listing_jobs|does not exist|could not find/i.test(jErr.message)) return 0; // unsure -> delete nothing
  for (const j of jobs ?? []) {
    for (const u of ((j.input as { photoUrls?: string[] })?.photoUrls ?? [])) {
      const p = storagePath(u, deps.supabaseUrl);
      if (p) used.add(p);
    }
  }
  const cutoff = now - ORPHAN_MIN_AGE_DAYS * 86400_000;
  const orphans: string[] = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const { data, error } = await deps.db.storage.from(BUCKET).list(userId, { limit: 1000, offset, sortBy: { column: "created_at", order: "asc" } });
    if (error) return 0;
    for (const f of data ?? []) {
      const path = `${userId}/${f.name}`;
      const created = Date.parse(f.created_at ?? "");
      if (f.id && Number.isFinite(created) && created <= cutoff && !used.has(path)) orphans.push(path);
    }
    if (!data || data.length < 1000) break;
  }
  let removed = 0;
  for (let i = 0; i < orphans.length; i += 100) {
    const { error } = await deps.db.storage.from(BUCKET).remove(orphans.slice(i, i + 100));
    if (!error) removed += Math.min(100, orphans.length - i);
  }
  return removed;
}

/** Picture URLs of a live listing, from eBay GetItem (eBay-hosted copies). */
export function parsePictureUrls(xml: string): string[] {
  const block = xml.match(/<PictureDetails>([\s\S]*?)<\/PictureDetails>/)?.[1] ?? "";
  return [...block.matchAll(/<PictureURL>([^<]+)<\/PictureURL>/g)].map((m) => m[1].trim()).filter((u) => /^https:\/\//.test(u));
}
