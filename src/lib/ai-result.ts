import type { Condition } from "@/lib/pricing";

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
}

export function formatMeasurements(r: AiResult): string {
  const parts: string[] = [];
  if (r.pitToPit) parts.push(`Pit to pit: ${r.pitToPit}`);
  if (r.length) parts.push(`Length: ${r.length}`);
  if (r.waist) parts.push(`Waist: ${r.waist}`);
  if (r.inseam) parts.push(`Inseam: ${r.inseam}`);
  return parts.length > 0 ? `Measurements: ${parts.join(", ")}.` : "";
}
