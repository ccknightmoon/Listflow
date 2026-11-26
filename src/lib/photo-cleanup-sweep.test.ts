import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findLegacyOrphans, findOrphans, legacyOwner, previewCleanup, runPhotoCleanup } from "./photo-cleanup";

const SB = "https://proj.supabase.co";
const U = "6c0e7bd3-3668-4990-b8a4-70d9f6a1ac61";
const DAY = 86400_000;
const NOW = Date.parse("2026-11-26T12:00:00Z");
const pub = (path: string) => `${SB}/storage/v1/object/public/photos/${path}`;
const old = new Date(NOW - 40 * DAY).toISOString();
const young = new Date(NOW - 2 * DAY).toISOString();

type F = { name: string; id: string | null; created_at: string; metadata?: { size: number } };

function db(opts: { drafts?: Array<Record<string, unknown>>; trash?: Array<Record<string, unknown>>; files: Record<string, F[]>; settings?: Record<string, unknown> }) {
  const removed: Array<{ bucket: string; paths: string[] }> = [];
  const q = (table: string) => {
    const rows = table === "drafts" ? opts.drafts ?? [] : table === "draft_trash" ? opts.trash ?? [] : table === "app_settings" ? [opts.settings ?? {}] : [];
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "limit", "order"]) b[m] = () => b;
    b.range = () => Promise.resolve({ data: rows, error: null });
    b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    b.update = () => b;
    b.then = (r: (v: unknown) => void) => r({ data: rows, error: null });
    return b;
  };
  const client = {
    from: q,
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string) => ({ data: opts.files[`${bucket}:${prefix}`] ?? [], error: null }),
        remove: async (paths: string[]) => (removed.push({ bucket, paths }), { error: null }),
      }),
    },
  } as unknown as SupabaseClient;
  return { client, removed };
}

afterEach(() => vi.unstubAllEnvs());

describe("orphan sweep (both buckets)", () => {
  it("finds unused, old files in the public AND private bucket; keeps used and young ones", async () => {
    const { client } = db({
      drafts: [{ id: "d", photo_urls: [pub(`${U}/used.jpg`), `/api/photos/${U}/kept.jpg`], thumbnail_url: null }],
      trash: [{ photo_urls: [pub(`${U}/trashed.jpg`)] }],
      files: {
        [`photos:${U}`]: [
          { name: "used.jpg", id: "1", created_at: old }, { name: "trashed.jpg", id: "2", created_at: old },
          { name: "gone.jpg", id: "3", created_at: old, metadata: { size: 1048576 } }, { name: "new.jpg", id: "4", created_at: young },
        ],
        [`photos-private:${U}`]: [{ name: "kept.jpg", id: "5", created_at: old }, { name: "lost.jpg", id: "6", created_at: old, metadata: { size: 524288 } }],
      },
    });
    const drafts = [{ id: "d", ebay_listing_id: null, ebay_listed_at: null, photo_urls: [pub(`${U}/used.jpg`), `/api/photos/${U}/kept.jpg`], thumbnail_url: null }];
    const r = await findOrphans({ db: client, supabaseUrl: SB, ebayPictures: async () => [] }, U, drafts, NOW);
    expect(r.paths.sort()).toEqual([`${U}/gone.jpg`, `private:${U}/lost.jpg`].sort());
    expect(r.bytes).toBe(1048576 + 524288);
  });
});

describe("legacy photos/public/ folder", () => {
  const files = { "photos:public": [
    { name: "a.jpg", id: "1", created_at: old, metadata: { size: 100 } },
    { name: "b.jpg", id: "2", created_at: old },
    { name: "c.jpg", id: "3", created_at: young },
  ] };
  it("is never touched unless PHOTO_LEGACY_OWNER_ID names this seller", async () => {
    expect(legacyOwner({})).toBeNull();
    expect(legacyOwner({ PHOTO_LEGACY_OWNER_ID: "nope" })).toBeNull();
    const { client, removed } = db({ files, settings: { photo_cleanup_enabled: false, photo_cleanup_orphans: true } });
    const r = await runPhotoCleanup({ db: client, supabaseUrl: SB, ebayPictures: async () => [], now: () => NOW }, U, { force: true });
    expect(r.legacyDeleted).toBeUndefined();
    expect(removed.flatMap((x) => x.paths).filter((p) => p.startsWith("public/"))).toEqual([]);
  });
  it("keeps files any draft uses and anything under 30 days", async () => {
    const { client } = db({ drafts: [{ photo_urls: [pub("public/b.jpg")], thumbnail_url: null }], files });
    const r = await findLegacyOrphans({ db: client, supabaseUrl: SB, ebayPictures: async () => [] }, NOW);
    expect(r.paths).toEqual(["public/a.jpg"]);
  });
  it("owner + orphans on: deletes them; preview shows counts without deleting", async () => {
    vi.stubEnv("PHOTO_LEGACY_OWNER_ID", U);
    const p = db({ files });
    const prev = await previewCleanup({ db: p.client, supabaseUrl: SB, ebayPictures: async () => [], now: () => NOW }, U);
    expect(prev.legacy).toMatchObject({ files: 2, enabled: true });
    expect(p.removed).toEqual([]);
    const run = db({ files, settings: { photo_cleanup_enabled: false, photo_cleanup_orphans: true } });
    const r = await runPhotoCleanup({ db: run.client, supabaseUrl: SB, ebayPictures: async () => [], now: () => NOW }, U, { force: true });
    expect(r.legacyDeleted).toBe(2);
    expect(run.removed.flatMap((x) => x.paths)).toEqual(["public/a.jpg", "public/b.jpg"]);
  });
  it("orphans OFF: legacy untouched even for the owner", async () => {
    vi.stubEnv("PHOTO_LEGACY_OWNER_ID", U);
    const run = db({ files, settings: { photo_cleanup_enabled: true, photo_cleanup_orphans: false } });
    await runPhotoCleanup({ db: run.client, supabaseUrl: SB, ebayPictures: async () => [], now: () => NOW }, U, { force: true });
    expect(run.removed).toEqual([]);
  });
});
