import { describe, it, expect } from "vitest";
import { createTtlDedupeCache } from "./ttl-cache";

// Lets a test control exactly when a fetcher resolves/rejects instead of
// relying on real timers, so the concurrency tests below are deterministic.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createTtlDedupeCache", () => {
  it("returns a cached value without refetching while the TTL hasn't elapsed", async () => {
    let now = 0;
    const cache = createTtlDedupeCache<number>(() => now);
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return 42;
    };

    expect(await cache.get("a", 1000, fetcher)).toBe(42);
    now += 500; // still inside the 1000ms TTL
    expect(await cache.get("a", 1000, fetcher)).toBe(42);

    expect(calls).toBe(1);
  });

  it("refetches once the TTL has elapsed", async () => {
    let now = 0;
    const cache = createTtlDedupeCache<number>(() => now);
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return calls;
    };

    expect(await cache.get("a", 1000, fetcher)).toBe(1);
    now += 1001; // past the TTL
    expect(await cache.get("a", 1000, fetcher)).toBe(2);

    expect(calls).toBe(2);
  });

  it("keeps separate keys independent", async () => {
    const cache = createTtlDedupeCache<string>();
    expect(await cache.get("a", 1000, async () => "a-value")).toBe("a-value");
    expect(await cache.get("b", 1000, async () => "b-value")).toBe("b-value");
    expect(cache.size()).toBe(2);
  });

  it("shares one in-flight fetch across concurrent callers for the same key", async () => {
    const cache = createTtlDedupeCache<number>();
    let calls = 0;
    const { promise, resolve } = deferred<number>();
    const fetcher = () => {
      calls++;
      return promise;
    };

    // Neither call is awaited yet -- both should see the same in-flight
    // fetch instead of each firing their own.
    const first = cache.get("a", 1000, fetcher);
    const second = cache.get("a", 1000, fetcher);

    resolve(7);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(firstResult).toBe(7);
    expect(secondResult).toBe(7);
  });

  it("does not cache a rejected fetch, so the next call retries", async () => {
    const cache = createTtlDedupeCache<number>();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      if (calls === 1) throw new Error("transient eBay error");
      return 99;
    };

    await expect(cache.get("a", 1000, fetcher)).rejects.toThrow("transient eBay error");
    expect(cache.size()).toBe(0);

    expect(await cache.get("a", 1000, fetcher)).toBe(99);
    expect(calls).toBe(2);
  });

  it("honors shouldCache to veto caching a successful-but-unwanted result", async () => {
    // Mirrors fetchAllOfListType's real use: an eBay error response
    // resolves successfully (it's not a thrown exception) but still
    // shouldn't be replayed to every other caller for the rest of the TTL.
    const cache = createTtlDedupeCache<{ error?: string }>();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { error: "not connected" };
    };
    const shouldCache = (v: { error?: string }) => !v.error;

    await cache.get("a", 1000, fetcher, shouldCache);
    expect(cache.size()).toBe(0);

    await cache.get("a", 1000, fetcher, shouldCache);
    expect(calls).toBe(2);
  });

  it("sweeps expired entries on the next successful write instead of growing forever", async () => {
    let now = 0;
    const cache = createTtlDedupeCache<number>(() => now);
    const fetcher = async () => 1;

    await cache.get("a", 1000, fetcher);
    expect(cache.size()).toBe(1);

    now += 1001; // "a" has now expired, but nothing has touched the map since
    await cache.get("b", 1000, fetcher); // writing a different key should still sweep "a"

    expect(cache.size()).toBe(1); // only "b" remains
  });
});
