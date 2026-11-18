/** eBay's minimum fixed price in USD. */
export const MIN_PRICE = 0.99;

/** Lowest price a listing may be set to: $0.99, or the item's cost if higher. */
export function priceFloor(costBasis: number | null | undefined): number {
  const c = typeof costBasis === "number" && Number.isFinite(costBasis) && costBasis > 0 ? costBasis : 0;
  return Math.max(MIN_PRICE, Math.round(c * 100) / 100);
}
