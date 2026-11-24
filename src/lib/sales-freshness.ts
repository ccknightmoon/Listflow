// Sales page auto-refresh policy (browser-safe, no server imports).
//
// The Sales feed is cached on the server (stale-while-revalidate, see
// src/lib/sales-feed-cache.ts) and in the tab. The page shows whatever it has
// straight away, then quietly fetches again when the copy it is showing is
// older than SALES_MAX_AGE_MS, or when the server says the copy it sent was
// stale (a rebuild is already running there).
export const SALES_MAX_AGE_MS = 12 * 60_000;
/** Freshness the follow-up request insists on (seconds, ?maxAge=). */
export const SALES_FOLLOWUP_MAX_AGE_S = 180;

export function salesNeedsRefresh(generatedAt: string | null | undefined, nowMs: number, maxAgeMs = SALES_MAX_AGE_MS): boolean {
  if (!generatedAt) return true;
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= maxAgeMs;
}
