// Draft create-body from an analyzed item, the same fields the Batch
// Upload page saves (handleSaveDraft) -- used by the background worker so a
// server-made draft looks exactly like one made in the browser.
import { formatMeasurements, storedSpecificsFrom, type AiResult } from "@/lib/ai-result";
import { getPriceSuggestion, type Condition, type PriceSuggestion } from "@/lib/pricing";
import { estimateIsHeavy } from "@/lib/shipping";

export function buildDraftPayload(result: AiResult, pricing: PriceSuggestion | null | undefined, photoUrls: string[]) {
  const hasRealPricing = !!pricing && !pricing.noData;
  const suggestion: PriceSuggestion = hasRealPricing
    ? pricing!
    : getPriceSuggestion(
        result.condition as Condition,
        Boolean(result.flaws && result.flaws.trim().length > 0),
        estimateIsHeavy(result.itemType, result.material),
        result.itemType,
        result.size,
        "calculated"
      );
  const measLine = formatMeasurements(result);
  const description = measLine && result.description ? `${measLine}\n\n${result.description}` : measLine || result.description || null;
  const specifics = storedSpecificsFrom(result);
  return {
    title: result.suggestedTitle,
    brand: result.brand,
    color: result.color,
    size: result.size,
    condition: result.condition,
    flaws: result.flaws,
    suggestedPrice: suggestion.suggestedPrice,
    costBasis: null,
    avgSold: hasRealPricing ? suggestion.avgSold : null,
    activeRangeLow: hasRealPricing ? suggestion.activeRangeLow : null,
    activeRangeHigh: hasRealPricing ? suggestion.activeRangeHigh : null,
    sellOdds: hasRealPricing ? suggestion.sellOdds : null,
    ...(photoUrls.length > 0 ? { thumbnailUrl: photoUrls[0], photoUrls } : {}),
    itemType: result.itemType ?? null,
    style: result.style ?? null,
    material: result.material ?? null,
    sleeveLength: result.sleeveLength ?? null,
    neckline: result.neckline ?? null,
    fit: result.fit ?? null,
    pattern: result.pattern ?? null,
    description,
    vintage: result.vintage ?? null,
    theme: result.theme ?? null,
    character: result.character ?? null,
    characterFamily: result.characterFamily ?? null,
    yearManufactured: result.yearManufactured ?? null,
    season: result.season ?? null,
    ...(specifics ? { itemSpecifics: specifics } : {}),
    storeCategoryId: null,
    storeCategoryName: null,
    isHeavy: false,
    shippingMode: "calculated" as const,
    shippingCost: null,
  };
}
