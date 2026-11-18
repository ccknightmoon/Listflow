// Makes an AI photo-grouping answer safe to use (Nov 2026).
//
// The model sometimes drops a photo, lists one twice, or invents an index.
// One bad photo must never fail a whole batch: this cleans the answer up
// and reports exactly what it changed so the seller can check it.
//
// Rules
// - Only whole numbers 0..n-1 count; anything else is dropped (reported).
// - A photo listed twice stays in the FIRST group it appeared in.
// - A missing photo joins the group of its nearest neighbour in upload
//   order (photos are taken item by item). If the photo before and after
//   it are in the same group, it goes there; otherwise the closer one
//   wins, and a tie goes to the earlier item (follow-up shots come after
//   an item's front photo).
// - If the answer is empty / unusable, every photo goes into one item and
//   `unusable` is set, so the seller splits it by hand.

export interface AutoPlacement {
  photo: number; // 0-based index within the batch
  group: number; // 0-based index into the repaired groups
}

export interface RepairResult {
  groups: number[][];
  autoPlaced: AutoPlacement[];
  duplicatesRemoved: number[];
  outOfRange: unknown[];
  unusable: boolean;
}

export interface GroupingCheck {
  missing: number[];
  duplicated: number[];
  outOfRange: unknown[];
  ok: boolean;
}

function asGroups(raw: unknown): unknown[][] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((g): g is unknown[] => Array.isArray(g));
}

const validIndex = (v: unknown, n: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < n;

/** Exact problems in a raw answer, without changing it. */
export function checkGrouping(raw: unknown, n: number): GroupingCheck {
  const counts = new Map<number, number>();
  const outOfRange: unknown[] = [];
  for (const g of asGroups(raw)) {
    for (const v of g) {
      if (validIndex(v, n)) counts.set(v, (counts.get(v) ?? 0) + 1);
      else outOfRange.push(v);
    }
  }
  const missing: number[] = [];
  const duplicated: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = counts.get(i) ?? 0;
    if (c === 0) missing.push(i);
    else if (c > 1) duplicated.push(i);
  }
  return { missing, duplicated, outOfRange, ok: missing.length === 0 && duplicated.length === 0 && outOfRange.length === 0 && asGroups(raw).length > 0 };
}

export function repairGroups(raw: unknown, n: number): RepairResult {
  const empty: RepairResult = { groups: [], autoPlaced: [], duplicatesRemoved: [], outOfRange: [], unusable: false };
  if (n <= 0) return empty;

  // 1) Keep valid, first-seen indices.
  const owner = new Array<number>(n).fill(-1);
  const kept: number[][] = [];
  const duplicatesRemoved: number[] = [];
  const outOfRange: unknown[] = [];
  for (const g of asGroups(raw)) {
    const group: number[] = [];
    for (const v of g) {
      if (!validIndex(v, n)) { outOfRange.push(v); continue; }
      if (owner[v] !== -1 || group.includes(v)) { duplicatesRemoved.push(v); continue; }
      group.push(v);
      owner[v] = kept.length; // provisional (group index before sorting)
    }
    if (group.length) kept.push(group); // a group of only bad indices is dropped
  }

  // Unusable answer: nothing valid at all.
  if (kept.length === 0) {
    return { groups: [Array.from({ length: n }, (_, i) => i)], autoPlaced: [], duplicatesRemoved, outOfRange, unusable: true };
  }

  // 2) Place each missing photo by its neighbours in upload order, using
  //    only photos the AI actually placed (so a run of missing photos
  //    splits between the two sides instead of all chaining one way).
  const placedOwner = owner.slice();
  const pending: Array<{ photo: number; to: number }> = [];
  for (let i = 0; i < n; i++) {
    if (placedOwner[i] !== -1) continue;
    let p = i - 1; while (p >= 0 && placedOwner[p] === -1) p--;
    let q = i + 1; while (q < n && placedOwner[q] === -1) q++;
    const prevG = p >= 0 ? placedOwner[p] : -1;
    const nextG = q < n ? placedOwner[q] : -1;
    let to: number;
    if (prevG !== -1 && prevG === nextG) to = prevG;
    else if (prevG === -1) to = nextG;
    else if (nextG === -1) to = prevG;
    else to = i - p <= q - i ? prevG : nextG;
    pending.push({ photo: i, to });
  }
  for (const { photo, to } of pending) { kept[to].push(photo); owner[photo] = to; }

  // 3) Tidy: photos ascending within an item, items by first photo.
  for (const g of kept) g.sort((a, b) => a - b);
  const order = kept.map((g, i) => ({ g, i })).sort((a, b) => a.g[0] - b.g[0]);
  const newIndexOf = new Map(order.map((o, ni) => [o.i, ni]));
  const groups = order.map((o) => o.g);

  return {
    groups,
    autoPlaced: pending.map(({ photo, to }) => ({ photo, group: newIndexOf.get(to)! })),
    duplicatesRemoved,
    outOfRange,
    unusable: false,
  };
}

/** Human notice, 1-based like the screen ("Photo 10 auto-placed with item 1 — check it"). */
export function describeRepairs(r: Pick<RepairResult, "autoPlaced" | "duplicatesRemoved" | "unusable">, photoOffset = 0, groupOffset = 0): string[] {
  if (r.unusable) return ["The AI couldn't group these photos, so they're all in one item — split them below."];
  const out = r.autoPlaced.map((a) => `Photo ${a.photo + photoOffset + 1} auto-placed with item ${a.group + groupOffset + 1} — check it.`);
  if (r.duplicatesRemoved.length) {
    const list = [...new Set(r.duplicatesRemoved)].map((p) => p + photoOffset + 1).join(", ");
    out.push(`Photo${r.duplicatesRemoved.length > 1 ? "s" : ""} ${list} ${r.duplicatesRemoved.length > 1 ? "were" : "was"} listed twice; kept in the first item.`);
  }
  return out;
}

/**
 * Per-photo labels → groups. Used by the strict retry, where the model
 * answers "does photo i start a new item?" for every index (much harder to
 * skip one than in a free-form groups list). Missing labels mean "same item".
 */
export function groupsFromStarts(labels: unknown, n: number): number[][] {
  const starts = new Set<number>([0]);
  if (Array.isArray(labels)) {
    for (const l of labels) {
      const o = l as { index?: unknown; startsNewItem?: unknown };
      if (validIndex(o?.index, n) && o.startsNewItem === true) starts.add(o.index);
    }
  }
  const groups: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (starts.has(i) || groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(i);
  }
  return groups;
}

/**
 * Batch-wide notices after all chunks are stitched together. Photo and item
 * numbers are 1-based, matching what the review screen shows.
 */
export function groupingNoticeLines(groups: number[][], autoPlaced: number[], duplicates: number[], unusable: boolean): string[] {
  const out: string[] = [];
  if (unusable) out.push("Part of this batch couldn't be grouped by the AI, so those photos are in one item — split them below.");
  for (const p of [...new Set(autoPlaced)].sort((a, b) => a - b)) {
    const g = groups.findIndex((grp) => grp.includes(p));
    if (g !== -1) out.push(`Photo ${p + 1} auto-placed with item ${g + 1} — check it.`);
  }
  const d = [...new Set(duplicates)].sort((a, b) => a - b);
  if (d.length) out.push(`Photo${d.length > 1 ? "s" : ""} ${d.map((p) => p + 1).join(", ")} ${d.length > 1 ? "were" : "was"} listed twice by the AI; kept in the first item.`);
  return out;
}
