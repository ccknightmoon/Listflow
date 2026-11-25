import { describe, it, expect } from "vitest";
import { deleteDraftsCompletely, ownedByUser, photoPathsToPurge, urlsInJson, type DeletableDraft } from "@/lib/draft-delete";

const SB = "https://proj.supabase.co";
const U = "6c0e7bd3-3668-4990-b8a4-70d9f6a1ac61";
const pub = (p: string) => `${SB}/storage/v1/object/public/photos/${p}`;

describe("photoPathsToPurge", () => {
  const target: DeletableDraft = { id: "d1", photo_urls: [pub(`${U}/a.jpg`), pub(`${U}/shared.jpg`), pub("public/legacy.jpg"), "https://i.ebayimg.com/x.jpg"], thumbnail_url: pub(`${U}/a.jpg`) };

  it("removes only the seller's own, unshared photos", () => {
    const r = photoPathsToPurge([target], [pub(`${U}/shared.jpg`)], SB, U);
    expect(r.purge).toEqual([`${U}/a.jpg`]);
    expect(r.kept).toBe(2); // shared one + legacy "public/" one
  });

  it("never touches another seller's folder or eBay's copies", () => {
    const other: DeletableDraft = { id: "d2", photo_urls: [pub("someone-else/z.jpg")], thumbnail_url: null };
    expect(photoPathsToPurge([other], [], SB, U).purge).toEqual([]);
  });

  it("handles private-bucket photo links", () => {
    expect(ownedByUser(`private:${U}/p.jpg`, U)).toBe(true);
    expect(ownedByUser("private:other/p.jpg", U)).toBe(false);
  });

  it("finds photo links inside a queued job's input", () => {
    expect(urlsInJson({ items: [{ photos: [pub(`${U}/q.jpg`), "not a url"] }] })).toEqual([pub(`${U}/q.jpg`)]);
  });
});

// Small in-memory stand-in: drafts + listing_jobs tables and a storage bucket.
function memDb(drafts: Array<DeletableDraft & { user_id: string }>, jobs: Array<{ user_id: string; status: string; input: unknown }> = []) {
  const removedFiles: string[] = [];
  const db = {
    from(table: string) {
      const f: Array<(r: Record<string, unknown>) => boolean> = [];
      let del = false;
      const rows = () => (table === "drafts" ? drafts : jobs) as Array<Record<string, unknown>>;
      const q = {
        select: () => q,
        delete: () => { del = true; return q; },
        eq: (k: string, v: unknown) => { f.push((r) => r[k] === v); return q; },
        in: (k: string, v: unknown[]) => { f.push((r) => v.includes(r[k])); return q; },
        then: (res: (v: unknown) => unknown) => {
          const hit = rows().filter((r) => f.every((fn) => fn(r)));
          if (del) for (const h of hit) drafts.splice(drafts.indexOf(h as never), 1);
          return Promise.resolve({ data: hit, error: null }).then(res);
        },
      };
      return q;
    },
    storage: { from: () => ({ remove: async (paths: string[]) => { removedFiles.push(...paths); return { error: null }; } }) },
  };
  return { db: db as never, removedFiles, drafts };
}

describe("deleteDraftsCompletely", () => {
  it("deletes the row and its own photos, keeps photos other drafts use, and reports real results", async () => {
    const m = memDb([
      { id: "d1", user_id: U, photo_urls: [pub(`${U}/a.jpg`), pub(`${U}/b.jpg`)], thumbnail_url: null },
      { id: "d2", user_id: U, photo_urls: [pub(`${U}/b.jpg`)], thumbnail_url: null },
    ]);
    const r = await deleteDraftsCompletely(m.db, m.db, U, ["d1", "missing"], SB);
    expect(r.deleted).toEqual(["d1"]);
    expect(r.notFound).toEqual(["missing"]);
    expect(m.removedFiles).toEqual([`${U}/a.jpg`]);
    expect(r).toMatchObject({ photosRemoved: 1, photosKept: 1 });
    expect(m.drafts.map((d) => d.id)).toEqual(["d2"]);
  });

  it("can't delete another seller's draft", async () => {
    const m = memDb([{ id: "x", user_id: "other", photo_urls: [], thumbnail_url: null }]);
    const r = await deleteDraftsCompletely(m.db, m.db, U, ["x"], SB);
    expect(r.deleted).toEqual([]);
    expect(m.drafts).toHaveLength(1);
  });

  it("keeps photos a queued job still needs", async () => {
    const m = memDb(
      [{ id: "d1", user_id: U, photo_urls: [pub(`${U}/q.jpg`)], thumbnail_url: null }],
      [{ user_id: U, status: "queued", input: { photos: [pub(`${U}/q.jpg`)] } }],
    );
    await deleteDraftsCompletely(m.db, m.db, U, ["d1"], SB);
    expect(m.removedFiles).toEqual([]);
  });
});
