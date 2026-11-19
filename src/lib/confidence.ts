// "Ready" vs "Needs a look" for the upload → List flow. Content-only score
// (photos/price are checked separately by listing-readiness at list time).
// Ready = score ≥ READY_SCORE and no blocking reason.

export const READY_SCORE = 80;

export interface ConfidenceInput {
  categoryNeedsReview?: boolean;
  issues?: string[]; // self-check + rejected values
  missingRequired?: string[];
  titleIssues?: string[];
  /** Brand read from a tag/label (vs. guessed from the look). */
  brandFromTag?: boolean;
  brandUnbranded?: boolean;
  sizeFromTag?: boolean;
  hasMeasurements?: boolean;
  photoCount?: number;
}

export interface ConfidenceReason { field: string; message: string; blocking: boolean; points: number }
export interface Confidence { score: number; ready: boolean; status: "ready" | "needs-look"; reasons: ConfidenceReason[] }

export function assessConfidence(i: ConfidenceInput): Confidence {
  const reasons: ConfidenceReason[] = [];
  const add = (field: string, message: string, points: number, blocking = false) => reasons.push({ field, message, points, blocking });
  if (i.categoryNeedsReview) add("Category", "Confirm the eBay category", 40, true);
  for (const x of i.issues ?? []) {
    if (/^Category looks wrong/.test(x)) add("Category", x, 40, true);
    else if (/isn't one of eBay's values/.test(x)) add(x.split(":")[0], x, 15, true);
    else add("Specifics", x, 10);
  }
  for (const m of i.missingRequired ?? []) add(m, `${m} is required by eBay — fill it in`, 20, true);
  for (const t of i.titleIssues ?? []) add("Title", t, 15, true);
  if (!i.brandFromTag && !i.brandUnbranded) add("Brand", "Brand wasn't read from a tag — check it", 15);
  if (!i.sizeFromTag) add("Size", "Size wasn't read from a tag — check it", 15);
  if (i.photoCount != null && i.photoCount < 2) add("Photos", "Only one photo", 10);
  const score = Math.max(0, 100 - reasons.reduce((s, r) => s + r.points, 0));
  const ready = score >= READY_SCORE && !reasons.some((r) => r.blocking);
  return { score, ready, status: ready ? "ready" : "needs-look", reasons };
}
