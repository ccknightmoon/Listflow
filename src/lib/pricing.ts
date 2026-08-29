import { estimateShippingCost, estimateShipping } from "@/lib/shipping";

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
  // The price to actually list at (comp value + shipping + eBay's fee,
  // grossed up, + margin) and the floor below which an accepted Best Offer
  // stops covering shipping and fees. Optional so older cached results /
  // callers that haven't been updated still type-check.
  listPrice?: number;
  floorPrice?: number;
  noData?: boolean;
}

// eBay's final value fee for most clothing categories, applied to the
// entire sale price including shipping. Varies by category and store
// level in reality — this is a reasonable flat approximation, not a
// per-category lookup.
const EBAY_FEE_RATE = 0.135;

/**
 * Turns a plain comp/target value into an actual list price and floor,
 * using the same break-even logic a reseller would do by hand: cover the
 * real shipping cost, gross up for eBay's cut (which is taken out of the
 * whole sale price, shipping included), then add margin. The floor is the
 * break-even point itself — the lowest an accepted offer can go while still
 * covering shipping and fees, before any profit.
 */
export function computeListAndFloor(targetValue: number, shippingCost: number): { listPrice: number; floorPrice: number } {
  const breakEven = (targetValue + shippingCost) / (1 - EBAY_FEE_RATE);
  const margin = Math.max(4, Math.round(breakEven * 0.15));
  return {
    listPrice: Math.round(breakEven + margin),
    floorPrice: Math.round(breakEven),
  };
}

/**
 * Fallback pricing used only when eBay's Browse API returns no usable comps
 * (see /api/pricing/suggest, which is the real, live-data path). This used
 * to be pure guesswork with an arbitrary base number; it's now grounded in
 * the same break-even formula as the real pricing path, just starting from
 * a condition-based estimate of "comp value" instead of an actual eBay
 * median — still an estimate, but a reasoned one rather than an arbitrary
 * one, and it now also returns a floor price so offers can be evaluated
 * consistently whether or not live comp data was available.
 */
export function getPriceSuggestion(
  condition: Condition,
  hasFlaws: boolean,
  isHeavy = false,
  itemType?: string | null,
  size?: string | null
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

  // Prefer the real weight-based estimate when we have an item type to work
  // with; fall back to the old flat heavy/not-heavy guess otherwise (e.g.
  // callers that only ever tracked the boolean).
  const shippingCost = itemType
    ? estimateShipping(itemType, size).cost
    : estimateShippingCost(isHeavy);
  const { listPrice, floorPrice } = computeListAndFloor(base, shippingCost);

  return {
    suggestedPrice: listPrice,
    avgSold: Math.round(base * 0.92),
    activeRangeLow: Math.round(base * 0.85),
    activeRangeHigh: Math.round(base * 1.2),
    sellOdds,
    comparableSoldCount: 24,
    comparableActiveCount: 11,
    listPrice,
    floorPrice,
  };
}
