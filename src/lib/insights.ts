// Turns sales history into a per-category breakdown for the Sales page --
// "your vintage tees sell in 4 days at 90% margin, your shoes sit for 6
// weeks" -- computed entirely from data the app already has (item_type/
// store_category_name/cost_basis on `drafts`, joined onto each sale by
// GET /api/ebay/sales) rather than any new eBay API call. Category resolves
// client-side as storeCategoryName ?? itemType ?? null before calling in
// here, same "most useful thing we actually know" fallback used elsewhere
// in the app (e.g. the store-category keyword matcher).
export interface InsightSale {
  category: string | null;
  total: number;
  costBasis: number | null;
  soldAt: string;
  // The closest available approximation of "when this went live" -- see
  // the caveat on CategoryInsight.avgDaysToSell below for why it's not a
  // real listing-start date for every sale.
  listedAt: string | null;
}

export interface CategoryInsight {
  category: string;
  count: number;
  revenue: number;
  totalCost: number;
  itemsWithCost: number;
  // null (not 0) when nothing in this group has a cost entered -- a real
  // 0% margin and "we don't know" must never look the same on screen.
  marginPercent: number | null;
  // null when nothing in this group has both a sold date and a listedAt to
  // diff -- same "don't claim precision you don't have" rule.
  avgDaysToSell: number | null;
  salesWithDays: number;
}

const DAY_MS = 86400000;

export function groupSalesByCategory(sales: InsightSale[]): CategoryInsight[] {
  const groups = new Map<string, InsightSale[]>();
  for (const s of sales) {
    const key = s.category ?? "Uncategorized";
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  const result: CategoryInsight[] = [];
  for (const [category, groupSales] of groups) {
    const count = groupSales.length;
    const revenue = groupSales.reduce((sum, s) => sum + s.total, 0);

    let totalCost = 0;
    let itemsWithCost = 0;
    for (const s of groupSales) {
      if (typeof s.costBasis === "number" && Number.isFinite(s.costBasis) && s.costBasis >= 0) {
        totalCost += s.costBasis;
        itemsWithCost++;
      }
    }
    // Margin only over the sales that actually have a cost -- mixing in
    // "unknown cost" sales as if their cost were 0 would inflate margin,
    // the opposite direction of the honest answer.
    let revenueOfCosted = 0;
    if (itemsWithCost > 0) {
      for (const s of groupSales) {
        if (typeof s.costBasis === "number" && Number.isFinite(s.costBasis) && s.costBasis >= 0) {
          revenueOfCosted += s.total;
        }
      }
    }
    const marginPercent = itemsWithCost > 0 && revenueOfCosted > 0
      ? ((revenueOfCosted - totalCost) / revenueOfCosted) * 100
      : null;

    let daysSum = 0;
    let salesWithDays = 0;
    for (const s of groupSales) {
      if (!s.listedAt) continue;
      const soldMs = Date.parse(s.soldAt);
      const listedMs = Date.parse(s.listedAt);
      if (isNaN(soldMs) || isNaN(listedMs)) continue;
      const diffDays = Math.round((soldMs - listedMs) / DAY_MS);
      // A relisted item's draft can predate its real eBay start time by a
      // lot -- a negative or wildly implausible diff is a sign the
      // approximation broke down for this one sale, not a real "sold
      // before it was listed." Excluded from the average rather than
      // dragging it negative or absurd; still counted in revenue/margin
      // above, which don't depend on this at all.
      if (diffDays < 0) continue;
      daysSum += diffDays;
      salesWithDays++;
    }
    const avgDaysToSell = salesWithDays > 0 ? daysSum / salesWithDays : null;

    result.push({ category, count, revenue, totalCost, itemsWithCost, marginPercent, avgDaysToSell, salesWithDays });
  }

  return result.sort((a, b) => b.revenue - a.revenue);
}
