// Which photos of an item the vision model sees at full detail (Volume
// Phase 1). Every photo is sent; tag/label/tape shots and the front shot at
// "high" detail (so tags and measurements are readable), the rest at "low"
// (cheap — still useful for color, graphics, flaws, back views).

// Phase 1: every photo a draft can hold (24, same cap as drafts.photo_urls)
// is read -- was 16, so tag/care-label shots at the end of a long item
// could be missed. Extra photos go at "low" detail (cheap).
export const MAX_ANALYSIS_PHOTOS = 24; // per item
export const MAX_HIGH_DETAIL = 6;
/** Up to this many photos, all go at full detail (no tag-finder call needed). */
export const ALL_HIGH_UP_TO = 6;

export type Detail = "high" | "low";

export interface TagFinderAnswer {
  front?: unknown;
  tags?: unknown;
}

/** Per-photo detail for `n` photos, using the tag-finder's answer when there is one. */
export function planDetail(n: number, finder?: TagFinderAnswer | null): Detail[] {
  const count = Math.min(n, MAX_ANALYSIS_PHOTOS);
  if (count <= ALL_HIGH_UP_TO) return Array(count).fill("high");
  const valid = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x < count;
  const high = new Set<number>();
  const front = valid(finder?.front) ? finder!.front : 0;
  high.add(front as number);
  const tags = Array.isArray(finder?.tags) ? (finder!.tags as unknown[]).filter(valid) : null;
  if (tags && tags.length) {
    for (const t of tags) if (high.size < MAX_HIGH_DETAIL) high.add(t);
  } else {
    // No answer: front shots first and tag/measurement shots usually last.
    for (const i of [1, count - 1, count - 2, count - 3, 2]) if (high.size < MAX_HIGH_DETAIL && i >= 0 && i < count) high.add(i);
  }
  return Array.from({ length: count }, (_, i) => (high.has(i) ? "high" : "low"));
}

export const TAG_FINDER_PROMPT = `These are photos of ONE secondhand item, numbered from 0 in order.
Which photo is the best full front view, and which photos show a tag or label
(brand tag, size tag, care/fiber tag, "Made in", RN number) or a tape measure?
Answer JSON only: {"front": <index>, "tags": [<indexes>]}`;
