// Per-user cache for the Sales analytics feed (see /api/ebay/sales/analytics),
// stale-while-revalidate: fresh for 3 minutes, then served instantly for up
// to 30 minutes while one background rebuild runs. Lives outside the route
// so other routes (e.g. saving a cost) can invalidate it.
import type { SalesFeed } from "./sales-feed";
import { createSwrCache, type SwrResult } from "./swr-cache";

export const SALES_FEED_FRESH_MS = 3 * 60_000;
export const SALES_FEED_STALE_MS = 30 * 60_000;
type FeedOrError = SalesFeed | { error: string; reconnect?: boolean };
const cache = createSwrCache<FeedOrError>();

/**
 * `maxAgeMs` lets a caller insist on data no older than that (the page's
 * follow-up request after it was shown stale data): it waits for the
 * rebuild instead of getting the stale copy again.
 */
export function getSalesFeed(
  userId: string,
  build: () => Promise<FeedOrError>,
  opts: { force?: boolean; maxAgeMs?: number } = {},
): Promise<SwrResult<FeedOrError>> {
  const fresh = opts.maxAgeMs != null ? Math.min(SALES_FEED_FRESH_MS, opts.maxAgeMs) : SALES_FEED_FRESH_MS;
  const stale = opts.maxAgeMs != null ? fresh : SALES_FEED_STALE_MS;
  return cache.get(userId, { freshMs: fresh, staleMs: stale, force: opts.force }, build, (f) => !("error" in f));
}

/** The cached feed for a seller, if any (never calls eBay). */
export function peekSalesFeed(userId: string): SalesFeed | null {
  const hit = cache.peek(userId);
  if (!hit || "error" in hit.value) return null;
  return hit.value;
}

export function invalidateSalesFeed(userId: string): void {
  cache.invalidate(userId);
}
