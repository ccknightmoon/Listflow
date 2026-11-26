import { describe, it, expect } from "vitest";
import { trashDrafts, restoreDrafts, purgeTrashNow, purgeExpiredTrash, listTrash, toTrashedItem, restorableRow, purgeAfter, TRASH_DAYS } from "@/lib/draft-trash";

const SB = "https://proj.supabase.co";
const U = "6c0e7bd3-3668-4990-b8a4-70d9f6a1ac61";
const OTHER = "11111111-2222-3333-4444-555555555555";
const pub = (p: string) => `${SB}/storage/v1/object/public/photos/${p}`;
const NOW = Date.parse("2026-11-25T12:00:00Z");
type Row = Record<string, unknown>;

// In-memory Supabase stand-in: tables, filters, insert/upsert/delete, storage.
function memDb(init: { drafts?: Row[]; draft_trash?: Row[]; listing_jobs?: Row[] } = {}, opts: { noTrashTable?: boolean; skuTaken?: string[] } = {}) {
  const tables: Record<string, Row[]> = { drafts: [...(init.drafts ?? [])], draft_trash: [...(init.draft_trash ?? [])], listing_jobs: [...(init.listing_jobs ?? [])] };
  const removedFiles: string[] = [];
  const missing = { code: "PGRST205", message: "Could not find the table 'public.draft_trash' in the schema cache" };
  const db = {
    from(table: string) {
      const f: Array<(r: Row) => boolean> = [];
      let op: "select" | "delete" | "upsert" = "select";
      let payload: Row[] = [];
      let ignoreDup = false;
      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        delete: () => { op = "delete"; return q; },
        upsert: (rows: Row[], o?: { ignoreDuplicates?: boolean }) => { op = "upsert"; payload = rows; ignoreDup = !!o?.ignoreDuplicates; return q; },
        eq: (k: string, v: unknown) => { f.push((r) => r[k] === v); return q; },
        in: (k: string, v: unknown[]) => { f.push((r) => v.includes(r[k])); return q; },
        lte: (k: string, v: string) => { f.push((r) => String(r[k]) <= v); return q; },
        then: (res: (v: unknown) => unknown) => {
          if (table === "draft_trash" && opts.noTrashTable) return Promise.resolve({ data: null, error: missing }).then(res);
          const rows = tables[table] ?? [];
          if (op === "upsert") {
            for (const p of payload) {
              if (table === "drafts" && p.custom_sku && (opts.skuTaken ?? []).includes(String(p.custom_sku))) {
                return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint drafts_user_id_custom_sku_key" } }).then(res);
              }
              const at = rows.findIndex((r) => r.id === p.id);
              if (at >= 0) { if (!ignoreDup) rows[at] = { ...p }; } else rows.push({ ...p });
            }
            return Promise.resolve({ data: payload, error: null }).then(res);
          }
          const hit = rows.filter((r) => f.every((fn) => fn(r)));
          if (op === "delete") for (const h of hit) rows.splice(rows.indexOf(h), 1);
          return Promise.resolve({ data: hit.map((h) => ({ ...h })), error: null }).then(res);
        },
      };
      return q;
    },
    storage: { from: () => ({ remove: async (paths: string[]) => { removedFiles.push(...paths); return { error: null }; } }) },
  };
  return { db: db as never, tables, removedFiles };
}

const draft = (id: string, extra: Row = {}): Row => ({ id, user_id: U, title: `Item ${id}`, suggested_price: 20, photo_urls: [pub(`${U}/${id}.jpg`)], thumbnail_url: pub(`${U}/${id}.jpg`), custom_sku: null, ...extra });

describe("trashDrafts (delete = move to the bin)", () => {
  it("removes the draft from drafts, keeps the full row and photos in the bin", async () => {
    const m = memDb({ drafts: [draft("d1"), draft("d2")] });
    const r = await trashDrafts(m.db, m.db, U, ["d1", "nope"], SB, NOW);
    expect(r).toMatchObject({ mode: "trash", trashed: ["d1"], notFound: ["nope"], purgeAfter: purgeAfter(NOW) });
    expect(m.tables.drafts.map((d) => d.id)).toEqual(["d2"]); // gone from every normal view
    expect(m.tables.draft_trash).toHaveLength(1);
    expect(m.tables.draft_trash[0]).toMatchObject({ id: "d1", user_id: U, photo_urls: [pub(`${U}/d1.jpg`)] });
    expect((m.tables.draft_trash[0].row as Row).title).toBe("Item d1");
    expect(m.removedFiles).toEqual([]); // photos untouched until purge
  });

  it("can't trash another seller's draft", async () => {
    const m = memDb({ drafts: [draft("x", { user_id: OTHER })] });
    const r = await trashDrafts(m.db, m.db, U, ["x"], SB, NOW);
    expect(r.trashed).toEqual([]);
    expect(m.tables.drafts).toHaveLength(1);
    expect(m.tables.draft_trash).toHaveLength(0);
  });

  it("without migration 037 it falls back to the old permanent delete", async () => {
    const m = memDb({ drafts: [draft("d1")] }, { noTrashTable: true });
    const r = await trashDrafts(m.db, m.db, U, ["d1"], SB, NOW);
    expect(r.mode).toBe("permanent");
    expect(r.trashed).toEqual(["d1"]);
    expect(m.tables.drafts).toHaveLength(0);
    expect(m.removedFiles).toEqual([`${U}/d1.jpg`]);
  });

  it("the bin expires after 7 days", () => {
    expect(TRASH_DAYS).toBe(7);
    expect(Date.parse(purgeAfter(NOW)) - NOW).toBe(7 * 86_400_000);
  });
});

describe("restoreDrafts (Undo)", () => {
  it("puts the same row back and empties it from the bin", async () => {
    const m = memDb({ drafts: [draft("d1")] });
    await trashDrafts(m.db, m.db, U, ["d1"], SB, NOW);
    const r = await restoreDrafts(m.db, U, ["d1"]);
    expect(r.restored).toEqual(["d1"]);
    expect(m.tables.drafts.map((d) => d.id)).toEqual(["d1"]);
    expect(m.tables.drafts[0].title).toBe("Item d1");
    expect(m.tables.draft_trash).toHaveLength(0);
  });

  it("always restores to the signed-in owner, whatever the saved JSON says", () => {
    expect(restorableRow({ id: "d1", user_id: OTHER, title: "t" }, U)).toEqual({ id: "d1", user_id: U, title: "t" });
  });

  it("restores without the SKU when another draft took it meanwhile", async () => {
    const m = memDb({ draft_trash: [{ id: "d1", user_id: U, row: draft("d1", { custom_sku: "SKU-1" }), photo_urls: [], deleted_at: "", purge_after: "" }] }, { skuTaken: ["SKU-1"] });
    const r = await restoreDrafts(m.db, U, ["d1"]);
    expect(r).toMatchObject({ restored: ["d1"], skuCleared: ["d1"] });
    expect(m.tables.drafts[0].custom_sku).toBeNull();
  });

  it("another seller's bin items can't be restored", async () => {
    const m = memDb({ draft_trash: [{ id: "d1", user_id: OTHER, row: draft("d1"), photo_urls: [], deleted_at: "", purge_after: "" }] });
    const r = await restoreDrafts(m.db, U, ["d1"]);
    expect(r.restored).toEqual([]);
    expect(m.tables.drafts).toHaveLength(0);
  });
});

describe("purging", () => {
  it("Delete now removes the bin row and only photos nothing else uses", async () => {
    const m = memDb({
      drafts: [draft("live", { photo_urls: [pub(`${U}/shared.jpg`)] })],
      draft_trash: [
        { id: "t1", user_id: U, row: {}, photo_urls: [pub(`${U}/t1.jpg`), pub(`${U}/shared.jpg`), pub(`${U}/t2.jpg`)], deleted_at: "", purge_after: "" },
        { id: "t2", user_id: U, row: {}, photo_urls: [pub(`${U}/t2.jpg`)], deleted_at: "", purge_after: "" },
      ],
      listing_jobs: [{ user_id: U, status: "queued", input: { photos: [pub(`${U}/t1.jpg`)] } }],
    });
    const r = await purgeTrashNow(m.db, m.db, U, ["t1"], SB);
    expect(r.purged).toEqual(["t1"]);
    // shared.jpg: a live draft uses it; t2.jpg: still in the bin; t1.jpg: a queued job needs it
    expect(m.removedFiles).toEqual([]);
    expect(m.tables.draft_trash.map((t) => t.id)).toEqual(["t2"]);
    const r2 = await purgeTrashNow(m.db, m.db, U, ["t2"], SB);
    expect(r2.photosRemoved).toBe(1);
    expect(m.removedFiles).toEqual([`${U}/t2.jpg`]);
  });

  it("the daily job purges only rows past their date, per seller", async () => {
    const old = new Date(NOW - 86_400_000).toISOString();
    const fresh = new Date(NOW + 3 * 86_400_000).toISOString();
    const m = memDb({
      draft_trash: [
        { id: "a", user_id: U, row: {}, photo_urls: [pub(`${U}/a.jpg`)], deleted_at: "", purge_after: old },
        { id: "b", user_id: U, row: {}, photo_urls: [pub(`${U}/b.jpg`)], deleted_at: "", purge_after: fresh },
        { id: "c", user_id: OTHER, row: {}, photo_urls: [pub(`${OTHER}/c.jpg`)], deleted_at: "", purge_after: old },
      ],
    });
    const r = await purgeExpiredTrash(m.db, SB, NOW);
    expect(r).toMatchObject({ sellers: 2, purged: 2, errors: 0 });
    expect(m.tables.draft_trash.map((t) => t.id)).toEqual(["b"]);
    expect(m.removedFiles.sort()).toEqual([`${OTHER}/c.jpg`, `${U}/a.jpg`]);
  });

  it("the daily job is a no-op before migration 037", async () => {
    const m = memDb({}, { noTrashTable: true });
    expect((await purgeExpiredTrash(m.db, SB, NOW)).skipped).toMatch(/037/);
    expect((await listTrash(m.db, U)).available).toBe(false);
  });
});

describe("bin listing", () => {
  it("shows a summary, never the whole row", () => {
    expect(toTrashedItem({ id: "d1", row: { title: "Shirt", suggested_price: "12.5", photo_urls: ["https://x/1.jpg"], description: "long" }, deleted_at: "a", purge_after: "b" }))
      .toEqual({ id: "d1", title: "Shirt", thumbnail: "https://x/1.jpg", price: 12.5, deletedAt: "a", purgeAfter: "b" });
  });
});
