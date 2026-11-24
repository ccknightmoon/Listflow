// Group camera-roll photos into items by WHEN they were taken (no AI).
//
// While shooting a batch, photos of one item come a few seconds apart, and
// there's a longer pause while the next item is laid out. So:
//   gap <= sameMaxMs  -> same item
//   gap >= newMinMs   -> new item
//   in between        -> "unclear": the caller asks AI about just that gap
//                        (each one independent, so they can run in parallel)
// The thresholds adapt a little to the seller's own pace (median gap).
// Browser-safe and pure; see src/lib/exif-time.ts for reading the times.

export interface TimeGroupOptions {
  /** Floor/ceiling for the "same item" threshold. */
  sameFloorMs?: number;
  sameCeilMs?: number;
  /** Floor for the "new item" threshold. */
  newFloorMs?: number;
  /** More unclear gaps than this -> not worth it, use AI grouping instead. */
  maxUnclear?: number;
}

export interface UnclearGap {
  /** Position of the gap in time order: between order[k] and order[k+1]. */
  k: number;
  gapMs: number;
  /** Up to 3 photos (indices) just before / after the gap, for the AI check. */
  before: number[];
  after: number[];
}

export type TimePlan =
  | { usable: false; reason: string }
  | {
      usable: true;
      /** Photo indices in time order. */
      order: number[];
      gaps: number[];
      sameMaxMs: number;
      newMinMs: number;
      unclear: UnclearGap[];
    };

const DEFAULTS: Required<TimeGroupOptions> = {
  sameFloorMs: 15_000,
  sameCeilMs: 30_000,
  newFloorMs: 45_000,
  maxUnclear: 40,
};

export function planTimeGroups(times: Array<number | null | undefined>, options: TimeGroupOptions = {}): TimePlan {
  const o = { ...DEFAULTS, ...options };
  const n = times.length;
  if (n < 2) return { usable: false, reason: "Not enough photos." };
  if (times.some((t) => typeof t !== "number" || !Number.isFinite(t))) {
    return { usable: false, reason: "Some photos have no time they were taken." };
  }
  const t = times as number[];
  const order = t.map((_, i) => i).sort((a, b) => t[a] - t[b] || a - b);
  const gaps: number[] = [];
  for (let k = 0; k < n - 1; k++) gaps.push(t[order[k + 1]] - t[order[k]]);

  // Times that are all (nearly) the same mean the phone gave us the time of
  // picking/exporting, not of shooting.
  const flat = gaps.filter((g) => g < 1000).length;
  if (flat > gaps.length / 2) return { usable: false, reason: "The photos' times look identical (no camera times)." };

  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const sameMaxMs = Math.min(o.sameCeilMs, Math.max(o.sameFloorMs, 3 * median));
  const newMinMs = Math.max(o.newFloorMs, 2 * sameMaxMs);

  const unclear: UnclearGap[] = [];
  gaps.forEach((g, k) => {
    if (g > sameMaxMs && g < newMinMs) {
      unclear.push({ k, gapMs: g, before: order.slice(Math.max(0, k - 2), k + 1), after: order.slice(k + 1, k + 4) });
    }
  });
  if (unclear.length > o.maxUnclear) return { usable: false, reason: "Too many unclear pauses between photos." };
  return { usable: true, order, gaps, sameMaxMs, newMinMs, unclear };
}

/**
 * Final groups. `sameItem[k]` is the answer for each unclear gap k (true =
 * same item). An unanswered unclear gap starts a new item (splitting is the
 * safer default: merging two items in review is one tap).
 */
export function resolveTimeGroups(plan: Extract<TimePlan, { usable: true }>, sameItem: Record<number, boolean> = {}): number[][] {
  const { order, gaps, sameMaxMs } = plan;
  const groups: number[][] = [[order[0]]];
  for (let k = 0; k < gaps.length; k++) {
    const g = gaps[k];
    const same = g <= sameMaxMs || (g < plan.newMinMs && sameItem[k] === true);
    if (same) groups[groups.length - 1].push(order[k + 1]);
    else groups.push([order[k + 1]]);
  }
  return groups;
}

/**
 * Reads an AI grouping answer for one unclear gap: the photos before and
 * after were sent together (before first); it's the same item when the last
 * "before" photo and the first "after" photo landed in the same group.
 */
export function sameItemFromAiGroups(aiGroups: number[][], beforeCount: number): boolean {
  const last = beforeCount - 1;
  const first = beforeCount;
  return aiGroups.some((g) => g.includes(last) && g.includes(first));
}
