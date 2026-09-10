// Generic short-lived cache + in-flight-request dedup ("thundering herd"
// protection). Pulled out as its own pure, dependency-free module so this
// behavior -- TTL expiry, concurrent callers sharing one in-flight fetch,
// expired entries getting swept instead of accumulating forever, and a
// failed fetch never getting cached -- can be unit tested without mocking
// network calls or request context, matching this repo's existing
// "pure-logic only" Vitest scope (see vitest.config.ts).
//
// Used by fetchAllOfListType (src/lib/ebay-listings.ts), which caches
// GetMyeBaySelling results per userId:listType. getAccessToken()
// (src/lib/ebay-oauth.ts) has the same "collapse concurrent callers into
// one real request" shape but predates this module and wasn't touched
// here -- left as its own hand-rolled version rather than folding it in
// as part of an unrelated change.
export interface TtlDedupeCache<V> {
  // Returns the cached value for `key` if it hasn't expired; otherwise
  // calls `fetcher()` once (sharing that one in-flight call across any
  // other concurrent `get()`s for the same key) and caches the result for
  // `ttlMs`. `shouldCache` (default: always) can veto caching a particular
  // result -- e.g. an error response that shouldn't be replayed to every
  // other caller for the rest of the TTL window.
  get(key: string, ttlMs: number, fetcher: () => Promise<V>, shouldCache?: (value: V) => boolean): Promise<V>;
  // Drops every entry whose TTL has already elapsed. get() calls this on
  // every successful write already, so the map can't grow unbounded over
  // the life of a warm process -- exposed too, for a caller that wants to
  // sweep on its own schedule instead.
  evictExpired(now?: number): void;
  // Number of live (not-yet-swept) entries -- mainly for tests.
  size(): number;
}

export function createTtlDedupeCache<V>(now: () => number = Date.now): TtlDedupeCache<V> {
  const store = new Map<string, { value: V; expires: number }>();
  const inFlight = new Map<string, Promise<V>>();

  function evictExpired(nowMs: number = now()) {
    for (const [key, entry] of store) {
      if (entry.expires <= nowMs) store.delete(key);
    }
  }

  async function get(
    key: string,
    ttlMs: number,
    fetcher: () => Promise<V>,
    shouldCache: (value: V) => boolean = () => true
  ): Promise<V> {
    const cached = store.get(key);
    if (cached && cached.expires > now()) {
      return cached.value;
    }

    const existing = inFlight.get(key);
    if (existing) return existing;

    const promise = fetcher()
      .then((value) => {
        if (shouldCache(value)) {
          // Sweep before writing, not after -- keeps the map from ever
          // holding more than one expired entry per key at a time instead
          // of only shrinking on whichever key happens to get written to
          // next.
          evictExpired(now());
          store.set(key, { value, expires: now() + ttlMs });
        }
        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, promise);
    return promise;
  }

  return { get, evictExpired, size: () => store.size };
}
