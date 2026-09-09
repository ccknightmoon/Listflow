// Shared with src/app/store/page.tsx (the "Stale" badge/filter) and
// src/app/dashboard/page.tsx (the Dashboard's stale-listings count tile,
// added later) so the threshold and the day-math live in exactly one
// place -- both used to only exist inside store/page.tsx, so a dashboard
// count that used its own copy could silently drift from what /store
// itself considers stale.

// An active listing sitting this long with no sale is a real, actionable
// signal to a reseller (eBay's own search ranking rewards freshness, and a
// stale listing is the natural next thing to price-drop or refresh) -- flag
// it rather than let it silently sit unnoticed among newer listings.
export const STALE_DAYS_THRESHOLD = 30;

export function daysSinceDate(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr).getTime();
  if (isNaN(ms)) return null;
  return Math.floor(ms / 86400000);
}

export function isStale(startTime: string | null): boolean {
  const d = daysSinceDate(startTime);
  return d !== null && d >= STALE_DAYS_THRESHOLD;
}
