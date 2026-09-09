// Shared helpers for the Sales page's "true profit" figure -- net revenue
// (after eBay's estimated fee, see src/lib/ebay-fees.ts) minus the seller's
// own cost basis for each sold item, where they've entered one. Most sales
// won't have a cost entered (it's a manual field -- nothing in the app can
// infer what someone paid to acquire an item), so this is always presented
// alongside how many of the sales it actually covers, never silently as if
// it applied to all of them.
export function isValidCostBasis(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export interface CostSummary {
  totalCost: number;
  itemsWithCost: number;
  itemsMissingCost: number;
}

export function summarizeCost(sales: Array<{ costBasis: number | null }>): CostSummary {
  let totalCost = 0;
  let itemsWithCost = 0;
  for (const s of sales) {
    if (isValidCostBasis(s.costBasis)) {
      totalCost += s.costBasis;
      itemsWithCost++;
    }
  }
  return { totalCost, itemsWithCost, itemsMissingCost: sales.length - itemsWithCost };
}
