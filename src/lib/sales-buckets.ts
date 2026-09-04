// Buckets sold-at timestamps into ~weekly windows ending today, most recent
// week last. Shared by the Sales page's "Revenue by week" chart and the
// Dashboard's compact trend sparkline so both compute the exact same
// numbers from the exact same definition of "week" — no drift between what
// the two screens show for the same underlying sales.
export interface BucketableSale {
  soldAt: string;
  total: number;
}

export interface WeeklyBuckets {
  totals: number[];
  // Each bucket's own start time (ms since epoch), oldest first — same
  // order as `totals`.
  weekStarts: number[];
}

export function bucketRevenueByWeek(
  sales: BucketableSale[],
  days: number,
  maxBuckets = 6
): WeeklyBuckets {
  const bucketCount = Math.max(1, Math.min(maxBuckets, Math.ceil(days / 7)));
  const weekMs = 7 * 86400000;
  const now = Date.now();
  const totals = new Array(bucketCount).fill(0);
  for (const s of sales) {
    const t = new Date(s.soldAt).getTime();
    const idx = Math.floor((now - t) / weekMs);
    if (idx >= 0 && idx < bucketCount) totals[bucketCount - 1 - idx] += s.total;
  }
  const weekStarts = totals.map((_, pos) => now - (bucketCount - pos) * weekMs);
  return { totals, weekStarts };
}
