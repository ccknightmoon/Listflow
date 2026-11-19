import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deletablePaths, parsePictureUrls, publishedDue, runPhotoCleanup, storagePath, type CleanupDraft } from "./photo-cleanup";

const SB = "https://proj.supabase.co";
const U = "user-1";
const ours = (f: string) => `${SB}/storage/v1/object/public/photos/${U}/${f}`;
const DAY = 86400_000;
const NOW = Date.parse("2026-11-18T12:00:00Z");

const draft = (id: string, o: Partial<CleanupDraft>): CleanupDraft => ({ id, ebay_listing_id: null, ebay_listed_at: null, photo_urls: [], thumbnail_url: null, ...o });

describe("photo cleanup rules", () => {
  it("only our own storage URLs count", () => {
    expect(storagePath(ours("a.jpg"), SB)).toBe(`${U}/a.jpg`);
    expect(storagePath("https://i.ebayimg.com/images/g/x/s-l1600.jpg", SB)).toBeNull();
    expect(storagePath("https://other.supabase.co/storage/v1/object/public/photos/u/a.jpg", SB)).toBeNull();
  });

  it("picks published drafts older than N days; never unpublished ones", () => {
    const ds = [
      draft("old-listed", { ebay_listing_id: "1", ebay_listed_at: new Date(NOW - 4 * DAY).toISOString(), photo_urls: [ours("a.jpg")] }),
      draft("new-listed", { ebay_listing_id: "2", ebay_listed_at: new Date(NOW - 1 * DAY).toISOString(), photo_urls: [ours("b.jpg")] }),
      draft("unpublished", { photo_urls: [ours("c.jpg")] }),
      draft("already-clean", { ebay_listing_id: "3", ebay_listed_at: new Date(NOW - 9 * DAY).toISOString(), photo_urls: ["https://i.ebayimg.com/x.jpg"] }),
    ];
    expect(publishedDue(ds, SB, 3, NOW).map((d) => d.id)).toEqual(["old-listed"]);
  });

  it("never deletes a photo another draft still uses", () => {
    const target = draft("t", { photo_urls: [ours("a.jpg"), ours("shared.jpg")], thumbnail_url: ours("a.jpg") });
    const other = draft("o", { photo_urls: [ours("shared.jpg")] });
    expect(deletablePaths(target, [target, other], SB)).toEqual([`${U}/a.jpg`]);
  });

  it("reads eBay-hosted picture URLs from GetItem", () => {
    const xml = "<Item><PictureDetails><GalleryURL>x</GalleryURL><PictureURL>https://i.ebayimg.com/1.jpg</PictureURL><PictureURL>https://i.ebayimg.com/2.jpg</PictureURL></PictureDetails></Item>";
    expect(parsePictureUrls(xml)).toEqual(["https://i.ebayimg.com/1.jpg", "https://i.ebayimg.com/2.jpg"]);
  });
});

// Minimal Supabase fake: records calls; tables are in-memory arrays.
function fakeDb(state: { settings: Record<string, unknown> | null; settingsError?: boolean; drafts: CleanupDraft[] }) {
  const removed: string[] = [];
  const updates: { table: string; patch: Record<string, unknown>; filters: [string, unknown][] }[] = [];
  function query(table: string) {
    const filters: [string, unknown][] = [];
    let patch: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push([c, v]), q),
      in: () => q,
      not: () => q,
      limit: () => q,
      update: (p: Record<string, unknown>) => ((patch = p), q),
      maybeSingle: async () =>
        table === "app_settings" ? (state.settingsError ? { data: null, error: { message: "column does not exist" } } : { data: state.settings, error: null }) : { data: null, error: null },
      then: (res: (v: unknown) => unknown) => {
        if (patch) {
          updates.push({ table, patch, filters: [...filters] });
          if (table === "drafts") {
            const id = filters.find((f) => f[0] === "id")?.[1];
            const d = state.drafts.find((x) => x.id === id);
            if (d) Object.assign(d, patch);
            return Promise.resolve(res({ data: d ? [{ id }] : [], error: null }));
          }
          return Promise.resolve(res({ data: [], error: null }));
        }
        if (table === "drafts") return Promise.resolve(res({ data: state.drafts.map((d) => ({ ...d })), error: null }));
        return Promise.resolve(res({ data: [], error: null }));
      },
    };
    return q;
  }
  const db = {
    from: query,
    storage: { from: () => ({ remove: async (p: string[]) => (removed.push(...p), { error: null }), list: async () => ({ data: [], error: null }) }) },
  } as unknown as SupabaseClient;
  return { db, removed, updates };
}

describe("runPhotoCleanup", () => {
  const listed = () => [
    draft("d1", { ebay_listing_id: "111", ebay_listed_at: new Date(NOW - 5 * DAY).toISOString(), photo_urls: [ours("a.jpg"), ours("b.jpg")], thumbnail_url: ours("a.jpg") }),
    draft("d2", { photo_urls: [ours("c.jpg")] }), // unpublished
  ];

  it("does nothing until migration 030 exists", async () => {
    const f = fakeDb({ settings: null, settingsError: true, drafts: listed() });
    const r = await runPhotoCleanup({ db: f.db, supabaseUrl: SB, ebayPictures: async () => ["https://i.ebayimg.com/1.jpg"], now: () => NOW }, U);
    expect(r.skippedReason).toMatch(/030/);
    expect(f.removed).toEqual([]);
  });

  it("switches the draft to eBay's copies, then deletes ours; unpublished untouched", async () => {
    const state = { settings: { photo_cleanup_enabled: true, photo_cleanup_days: 3, photo_cleanup_orphans: false, photo_cleanup_last_run: null }, drafts: listed() };
    const f = fakeDb(state);
    const r = await runPhotoCleanup({ db: f.db, supabaseUrl: SB, ebayPictures: async () => ["https://i.ebayimg.com/1.jpg", "https://i.ebayimg.com/2.jpg"], now: () => NOW }, U);
    expect(r).toMatchObject({ draftsCleaned: 1, photosDeleted: 2 });
    expect(f.removed.sort()).toEqual([`${U}/a.jpg`, `${U}/b.jpg`]);
    expect(state.drafts[0].photo_urls).toEqual(["https://i.ebayimg.com/1.jpg", "https://i.ebayimg.com/2.jpg"]);
    expect(state.drafts[1].photo_urls).toEqual([ours("c.jpg")]);
  });

  it("skips (deletes nothing) when eBay's copies can't be read", async () => {
    const f = fakeDb({ settings: { photo_cleanup_enabled: true, photo_cleanup_days: 3 }, drafts: listed() });
    const r = await runPhotoCleanup({ db: f.db, supabaseUrl: SB, ebayPictures: async () => [], now: () => NOW }, U);
    expect(r).toMatchObject({ draftsCleaned: 0, skipped: 1 });
    expect(f.removed).toEqual([]);
  });

  it("runs at most once a day and respects the off switch", async () => {
    const f = fakeDb({ settings: { photo_cleanup_enabled: true, photo_cleanup_days: 3, photo_cleanup_last_run: new Date(NOW - 3600_000).toISOString() }, drafts: listed() });
    expect((await runPhotoCleanup({ db: f.db, supabaseUrl: SB, ebayPictures: async () => ["x"], now: () => NOW }, U)).skippedReason).toBe("already ran today");
    const g = fakeDb({ settings: { photo_cleanup_enabled: false, photo_cleanup_orphans: false }, drafts: listed() });
    expect((await runPhotoCleanup({ db: g.db, supabaseUrl: SB, ebayPictures: async () => ["x"], now: () => NOW }, U)).skippedReason).toBe("turned off");
  });
});
