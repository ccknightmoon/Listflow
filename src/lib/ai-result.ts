import type { Condition } from "@/lib/pricing";
import { assessConfidence } from "@/lib/confidence";
import { titleIssues } from "@/lib/seo-title";

// Shape of a single item's AI vision analysis, as returned by
// /api/analyze-item and /api/analyze-batch (see src/lib/vision-prompt.ts for
// the prompt that produces it). Previously duplicated near-identically in
// new-listing/page.tsx and batch-upload/page.tsx.
export interface AiResult {
  itemType: string;
  brand: string;
  color: string;
  size: string;
  condition: Condition;
  flaws: string;
  suggestedTitle: string;
  style?: string;
  material?: string;
  sleeveLength?: string;
  neckline?: string;
  fit?: string;
  pattern?: string;
  description?: string;
  vintage?: string;
  theme?: string;
  character?: string;
  characterFamily?: string;
  yearManufactured?: string;
  season?: string;
  pitToPit?: string;
  length?: string;
  waist?: string;
  inseam?: string;
  // Listing quality (Nov 2026) — see src/lib/listing-enrich.ts
  department?: string;
  tagText?: string;
  era?: string;
  /** eBay category the specifics were filled for. */
  categoryId?: string | null;
  categoryPath?: string | null;
  categoryNeedsReview?: boolean;
  garmentKind?: string;
  /** Self-check contradictions (title vs category vs Type vs measurements). */
  issues?: string[];
  /** Ready / Needs a look (src/lib/confidence.ts). */
  confidence?: import("./confidence").Confidence;
  evidence?: { brandFromTag: boolean; sizeFromTag: boolean; materialFromTag?: boolean; countryFromTag?: boolean; singleStitch?: boolean; dateCode?: string | null };
  /** Category item specifics, eBay names → values. */
  itemSpecifics?: Record<string, string[]>;
  missingRequired?: string[];
  aspectDefs?: import("./item-specifics").AspectDef[];
  measurementsList?: import("./item-specifics").Measurement[];
  measurementLines?: string[];
}

/** What's stored in drafts.item_specifics (migration 027). */
export interface StoredSpecifics {
  categoryId: string | null;
  categoryPath?: string | null;
  categoryNeedsReview?: boolean;
  aspects: Record<string, string[]>;
  measurements: import("./item-specifics").Measurement[];
}

export function storedSpecificsFrom(r: Pick<AiResult, "categoryId" | "categoryPath" | "categoryNeedsReview" | "itemSpecifics" | "measurementsList"> | null | undefined): StoredSpecifics | null {
  if (!r || (!r.itemSpecifics && !r.measurementsList)) return null;
  return { categoryId: r.categoryId ?? null, categoryPath: r.categoryPath ?? null, categoryNeedsReview: !!r.categoryNeedsReview, aspects: r.itemSpecifics ?? {}, measurements: r.measurementsList ?? [] };
}

export function formatMeasurements(r: AiResult): string {
  if (r.measurementLines && r.measurementLines.length) return `Measurements: ${r.measurementLines.join(", ")}.`;
  const parts: string[] = [];
  if (r.pitToPit) parts.push(`Pit to pit: ${r.pitToPit}`);
  if (r.length) parts.push(`Length: ${r.length}`);
  if (r.waist) parts.push(`Waist: ${r.waist}`);
  if (r.inseam) parts.push(`Inseam: ${r.inseam}`);
  return parts.length > 0 ? `Measurements: ${parts.join(", ")}.` : "";
}

/**
 * Ready / Needs a look for an item as it is NOW (after the seller's edits):
 * same rules as the server, re-run on the current title and specifics.
 */
export function currentConfidence(r: Pick<AiResult, "evidence" | "missingRequired" | "issues" | "categoryNeedsReview" | "suggestedTitle" | "itemSpecifics">, photoCount?: number) {
  const aspects = r.itemSpecifics ?? {};
  return assessConfidence({
    categoryNeedsReview: r.categoryNeedsReview,
    issues: r.issues,
    missingRequired: r.missingRequired,
    titleIssues: titleIssues(r.suggestedTitle ?? "", aspects),
    brandFromTag: !!r.evidence?.brandFromTag,
    brandUnbranded: /^unbranded$/i.test(aspects["Brand"]?.[0] ?? ""),
    sizeFromTag: !!r.evidence?.sizeFromTag,
    photoCount,
  });
}
