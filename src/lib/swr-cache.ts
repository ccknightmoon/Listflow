// Per-user stale-while-revalidate cache for slow eBay reads (Nov 2026,
// speed pass). Per server instance, in memory.
//
//   age < freshMs            → cached value, no eBay call
//   freshMs ≤ age < staleMs  → cached value straight away, and ONE
//                              background refresh (kept alive past the
//                              response with next/server `after`)
//   age ≥ staleMs / missing  → wait for eBay
//
// Concurrent callers share one in-flight fetch. Failed fetches are never
// cached (`shouldCache`). Mutations call `invalidate(key)`.
import { after } from "next/server";

export interface SwrResult<V> {
  value: V;
  /** When this value was fetched (ms). */
  fetchedAt: number;
  /** True when served from cache past freshMs (a refresh is under way). */
  stale: boolean;
}

export interface SwrCache<V> {
  get(key: string, opts: { freshMs: number; staleMs: number; force?: boolean }, fetcher: () => Promise<V>, shouldCache?: (v: V) => boolean): Promise<SwrResult<V>>;
  /** The cached value without fetching (or undefined). */
  peek(key: string): { value: V; fetchedAt: number } | undefined;
  invalidate(key: string): void;
  invalidatePrefix(prefix: string): void;
  size(): number;
}

export function createSwrCache<V>(now: () => number = Date.now, keepAlive: (p: Promise<unknown>) => void = defaultKeepAlive): SwrCache<V> {
  const store = new Map<string, { value: V; at: number }>();
  const inflight = new Map<string, Promise<SwrResult<V>>>();

  function sweep(maxAge: number) {
    const t = now();
    for (const [k, e] of store) if (t - e.at > maxAge) store.delete(k);
  }

  function refresh(key: string, fetcher: () => Promise<V>, shouldCache: (v: V) => boolean, staleMs: number): Promise<SwrResult<V>> {
    const existing = inflight.get(key);
    if (existing) return existing;
    const p = fetcher()
      .then((value) => {
        const at = now();
        if (shouldCache(value)) {
          sweep(staleMs);
          store.set(key, { value, at });
        }
        return { value, fetchedAt: at, stale: false };
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  return {
    async get(key, { freshMs, staleMs, force }, fetcher, shouldCache = () => true) {
      const hit = store.get(key);
      const age = hit ? now() - hit.at : Infinity;
      if (!force && hit && age < freshMs) return { value: hit.value, fetchedAt: hit.at, stale: false };
      if (!force && hit && age < staleMs) {
        const bg = refresh(key, fetcher, shouldCache, staleMs);
        bg.catch(() => {});
        keepAlive(bg);
        return { value: hit.value, fetchedAt: hit.at, stale: true };
      }
      return refresh(key, fetcher, shouldCache, staleMs);
    },
    peek(key) { const e = store.get(key); return e ? { value: e.value, fetchedAt: e.at } : undefined; },
    invalidate(key) { store.delete(key); },
    invalidatePrefix(prefix) { for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k); },
    size() { return store.size; },
  };
}

function defaultKeepAlive(p: Promise<unknown>) {
  try {
    after(() => p.catch(() => {}));
  } catch {
    // Outside a request (tests, scripts): the promise just runs on.
  }
}
