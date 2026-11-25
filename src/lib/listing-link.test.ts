import { describe, it, expect, vi } from "vitest";
import { saveListingLink } from "@/lib/listing-link";

// Each update(...).select().maybeSingle() answers with the next scripted result.
function scripted(results: Array<{ data: unknown; error: unknown }>) {
  const updates: unknown[] = [];
  let i = 0;
  const db = {
    from: () => {
      const q: Record<string, unknown> = {};
      q.update = (v: unknown) => { updates.push(v); return q; };
      q.eq = () => q;
      q.select = () => q;
      q.maybeSingle = async () => results[Math.min(i++, results.length - 1)];
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res);
      return q;
    },
  };
  return { db: db as never, updates };
}

describe("saveListingLink", () => {
  it("saves and verifies the item number", async () => {
    const s = scripted([{ data: { id: "d1", ebay_listing_id: "123456789012" }, error: null }]);
    expect(await saveListingLink(s.db, "u1", "d1", "123456789012", { shipping_mode: "calculated" })).toEqual({ ok: true, attempts: 1 });
    expect(s.updates[0]).toEqual({ ebay_listing_id: "123456789012", shipping_mode: "calculated" });
  });

  it("retries a failed write instead of silently leaving the item in Drafts", async () => {
    const s = scripted([
      { data: null, error: { message: "timeout" } },
      { data: { id: "d1", ebay_listing_id: "123456789012" }, error: null },
    ]);
    expect(await saveListingLink(s.db, "u1", "d1", "123456789012", {}, { delayMs: 0 })).toEqual({ ok: true, attempts: 2 });
  });

  it("reports failure after the last attempt", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = scripted([{ data: null, error: { message: "down" } }]);
    const r = await saveListingLink(s.db, "u1", "d1", "123456789012", {}, { attempts: 2, delayMs: 0 });
    expect(r).toMatchObject({ ok: false, error: "down" });
    spy.mockRestore();
  });

  it("stops at once when the draft no longer exists", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = scripted([{ data: null, error: null }]);
    expect((await saveListingLink(s.db, "u1", "gone", "123456789012", {}, { delayMs: 0 })).ok).toBe(false);
    expect(s.updates).toHaveLength(1);
    spy.mockRestore();
  });
});
