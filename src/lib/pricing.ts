export type Condition =
  | "New with tags"
  | "New without tags"
  | "Excellent used"
  | "Good - minor flaws"
  | "Fair - notable flaws";

export interface PriceSuggestion {
  suggestedPrice: number;
  avgSold: number;
  activeRangeLow: number;
  activeRangeHigh: number;
  sellOdds: "High" | "Medium" | "Low";
  comparableSoldCount: number;
  comparableActiveCount: number;
  noData?: boolean;
}

/**
 * MOCK pricing logic.
 *
 * Replace this function body with real calls to:
 *  - eBay Marketplace Insights API (sold comps)
 *  - eBay Browse API (active listings)
 *  - Claude vision API (item identification from photos)
 *
 * Keep the same return shape so the UI doesn't need to change.
 */
export function getPriceSuggestion(
  condition: Condition,
  hasFlaws: boolean
): PriceSuggestion {
  let base = 35;

  switch (condition) {
    case "New with tags":
      base = 55;
      break;
    case "New without tags":
      base = 45;
      break;
    case "Excellent used":
      base = 38;
      break;
    case "Good - minor flaws":
      base = 28;
      break;
    case "Fair - notable flaws":
      base = 18;
      break;
  }

  let sellOdds: PriceSuggestion["sellOdds"] = "High";

  if (hasFlaws) {
    base = Math.round(base * 0.85);
    sellOdds = "Medium";
  }

  return {
    suggestedPrice: base,
    avgSold: Math.round(base * 0.92),
    activeRangeLow: Math.round(base * 0.85),
    activeRangeHigh: Math.round(base * 1.2),
    sellOdds,
    comparableSoldCount: 24,
    comparableActiveCount: 11,
  };
}
