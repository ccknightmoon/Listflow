// Per-user, per-server-instance cache for the Sales analytics feed (see
// /api/ebay/sales/analytics). Lives outside the route file so other
// routes (e.g. saving a cost) can invalidate it.
import type { SalesFeed } from "./sales-feed";

export const SALES_FEED_CACHE_MS = 3 * 60_000;
const cache = new Map<string, { at: number; feed: SalesFeed }>();

export function getCachedSalesFeed(userId: string, now = Date.now()): SalesFeed | null {
  const hit = cache.get(userId);
  return hit && now - hit.at < SALES_FEED_CACHE_MS ? hit.feed : null;
}

export function setCachedSalesFeed(userId: string, feed: SalesFeed): void {
  cache.set(userId, { at: Date.now(), feed });
}

export function invalidateSalesFeed(userId: string): void {
  cache.delete(userId);
}
