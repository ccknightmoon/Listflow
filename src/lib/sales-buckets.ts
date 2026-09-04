// Buckets sold-at timestamps into a fixed number of trailing periods ending
// today, most recent period last. Shared by the Sales page's "Revenue"
// chart and the Dashboard's compact trend sparkline so both compute the
// exact same numbers from the exact same period definition — no drift
// between what the two screens show for the same underlying sales.
//
// The period width adapts to the requested window: a 7-day (or shorter)
// window buckets by DAY, so the chart reads as a real day-by-day trend
// instead of collapsing into one giant bar; anything longer buckets by
// WEEK, so a 30- or 90-day view stays readable while still covering the
// whole window (90 days gets 13 weekly bars, not a bar count capped
// below what the window actually spans).
export interface BucketableSale {
  soldAt: string;
  total: number;
}

export interface RevenueBuckets {
  totals: number[];
  // Each bucket's own start time (ms since epoch), oldest first — same
  // order as `totals`.
  bucketStarts: number[];
  // Width of one bucket, in ms. Callers use this (or the `days` they
  // passed in) to decide whether to label bars as daily or weekly.
  bucketMs: number;
}

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

export function bucketRevenue(sales: BucketableSale[], days: number): RevenueBuckets {
  const bucketMs = days <= 7 ? DAY_MS : WEEK_MS;
  const bucketCount = Math.max(1, Math.ceil(days / (bucketMs / DAY_MS)));
  const now = Date.now();
  const totals = new Array(bucketCount).fill(0);
  for (const s of sales) {
    const t = new Date(s.soldAt).getTime();
    const idx = Math.floor((now - t) / bucketMs);
    if (idx >= 0 && idx < bucketCount) totals[bucketCount - 1 - idx] += s.total;
  }
  const bucketStarts = totals.map((_, pos) => now - (bucketCount - pos) * bucketMs);
  return { totals, bucketStarts, bucketMs };
}

// Compact currency for tight chart labels: $342, $1.2k, $12k — never cents,
// since the point is a quick relative read, not a precise figure.
export function formatCompactCurrency(n: number): string {
  if (n >= 10000) return `$${Math.round(n / 1000)}k`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}
