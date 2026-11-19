import { afterEach, describe, expect, it, vi } from "vitest";
import { __setCacheStoreForTests, dbCacheGet, dbCacheSet, type CacheStore } from "./metadata-cache";

afterEach(() => __setCacheStoreForTests(null));

function memStore(): CacheStore & { rows: Map<string, { payload: unknown; fetched_at: string }> } {
  const rows = new Map<string, { payload: unknown; fetched_at: string }>();
  return {
    rows,
    async get(k) { return rows.get(k) ?? null; },
    async set(k, payload) { rows.set(k, { payload, fetched_at: new Date().toISOString() }); },
  };
}

describe("eBay metadata DB cache", () => {
  it("round-trips a fresh copy", async () => {
    const s = memStore();
    __setCacheStoreForTests(s);
    dbCacheSet("aspects:123", [{ name: "Brand" }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(await dbCacheGet("aspects:123")).toEqual([{ name: "Brand" }]);
  });

  it("ignores a stale copy", async () => {
    const s = memStore();
    s.rows.set("k", { payload: 1, fetched_at: new Date(Date.now() - 2 * 86400000).toISOString() });
    __setCacheStoreForTests(s);
    expect(await dbCacheGet("k")).toBeNull();
  });

  it("turns itself off when the table doesn't exist (migration 028 not applied)", async () => {
    const get = vi.fn(async () => { throw { code: "42P01", message: 'relation "ebay_metadata_cache" does not exist' }; });
    __setCacheStoreForTests({ get, set: async () => {} });
    expect(await dbCacheGet("a")).toBeNull();
    expect(await dbCacheGet("b")).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("treats other errors as a miss without throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    __setCacheStoreForTests({ get: async () => { throw new Error("timeout"); }, set: async () => { throw new Error("x"); } });
    expect(await dbCacheGet("a")).toBeNull();
    expect(() => dbCacheSet("a", 1)).not.toThrow();
  });
});
