import { describe, it, expect } from "vitest";
import {
  currentPeriod, previousPeriod, bucketPeriod, chooseFee, feeBase, summarizePeriod, percentChange,
  sellThrough, resolveCategory, categoryFromText, categoryBreakdown, buildInsights, localDayStart,
  type AnalyticsSale,
} from "./sales-analytics";
import { estimateEbayFee } from "./ebay-fees";

// Tests run in whatever TZ the machine has; all expectations are written
// in local time so they hold in any zone.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const NOW = at(2026, 11, 16, 23, 59); // Nov 16, 11:59pm local

function sale(over: Partial<AnalyticsSale> = {}): AnalyticsSale {
  return {
    key: Math.random().toString(36).slice(2),
    listingId: "1", title: "Vintage Tee", qty: 1, itemTotal: 20, shippingPaid: 5, taxPaid: 2,
    soldAt: iso(NOW - 3600_000), listedAt: null, ebayCategory: null, storeCategoryName: null,
    itemType: null, costBasis: null, actualFee: null, ...over,
  };
}

describe("periods (local time, inclusive of today)", () => {
  it("30d starts at local midnight 29 days ago -- Oct 18 for Nov 16", () => {
    const p = currentPeriod(30, NOW);
    expect(new Date(p.start).getDate()).toBe(18);
    expect(new Date(p.start).getMonth()).toBe(9); // October
    expect(new Date(p.start).getHours()).toBe(0);
  });
  it("7d covers Nov 10 through today", () => {
    expect(new Date(currentPeriod(7, NOW).start).getDate()).toBe(10);
  });
  it("previous period is the same length immediately before", () => {
    const cur = currentPeriod(30, NOW);
    const prev = previousPeriod(30, NOW);
    expect(prev.end).toBe(cur.start);
    expect(prev.start).toBe(localDayStart(cur.start, -30));
  });
  it("a sale at 11:30pm local on the first day is inside; 1 minute before midnight the day before is not", () => {
    const p = currentPeriod(7, NOW);
    const s = [sale({ soldAt: iso(p.start + 60_000) }), sale({ soldAt: iso(p.start - 60_000) })];
    const b = bucketPeriod(s, 7, NOW);
    expect(b.reduce((a, x) => a + x.count, 0)).toBe(1);
  });
});

describe("bucketPeriod", () => {
  it("7d = 7 daily bars, none partial", () => {
    const b = bucketPeriod([], 7, NOW);
    expect(b).toHaveLength(7);
    expect(b.every((x) => !x.partial && x.days === 1)).toBe(true);
  });
  it("30d = 4 full weeks + one 2-day partial bar, starting on the period's first day", () => {
    const b = bucketPeriod([], 30, NOW);
    expect(b.map((x) => x.days)).toEqual([7, 7, 7, 7, 2]);
    expect(b[4].partial).toBe(true);
    expect(b[0].start).toBe(currentPeriod(30, NOW).start);
  });
  it("90d = 12 full weeks + one 6-day partial bar", () => {
    expect(bucketPeriod([], 90, NOW).map((x) => x.days)).toEqual([...Array(12).fill(7), 6]);
  });
  it("bars always add up exactly to the period total, and ignore out-of-period sales", () => {
    const p = currentPeriod(30, NOW);
    const sales: AnalyticsSale[] = [];
    for (let i = 0; i < 200; i++) {
      const t = p.start - 5 * 86_400_000 + i * 4.3 * 3600_000; // some before the period
      sales.push(sale({ soldAt: iso(t), itemTotal: 10 + (i % 7) * 3.33 }));
    }
    const bars = bucketPeriod(sales, 30, NOW);
    const barSum = Math.round(bars.reduce((a, b) => a + b.total, 0) * 100) / 100;
    const s = summarizePeriod(sales, p, 13.6);
    expect(barSum).toBeCloseTo(s.itemSales, 2);
    expect(bars.reduce((a, b) => a + b.count, 0)).toBe(s.orders);
  });
});

describe("fees", () => {
  it("uses eBay's real fee when Finances reported one", () => {
    expect(chooseFee(sale({ actualFee: 3.21 }), 13.6)).toEqual({ fee: 3.21, actual: true });
  });
  it("a real fee of 0 is still real", () => {
    expect(chooseFee(sale({ actualFee: 0 }), 13.6)).toEqual({ fee: 0, actual: true });
  });
  it("falls back to an estimate on item + shipping + tax", () => {
    const s = sale({ itemTotal: 20, shippingPaid: 5, taxPaid: 2 });
    expect(feeBase(s)).toBe(27);
    expect(chooseFee(s, 13.6).fee).toBeCloseTo(estimateEbayFee(27, 13.6), 2);
    expect(chooseFee(s, 13.6).actual).toBe(false);
  });
});

describe("summarizePeriod", () => {
  const p = currentPeriod(30, NOW);
  it("counts units for multi-quantity sales and averages per unit", () => {
    const s = summarizePeriod([sale({ qty: 3, itemTotal: 30 }), sale({ qty: 1, itemTotal: 10 })], p, 13.6);
    expect(s.units).toBe(4);
    expect(s.orders).toBe(2);
    expect(s.itemSales).toBe(40);
    expect(s.avgSalePrice).toBe(10);
  });
  it("splits actual vs estimated fee counts and reports missing costs", () => {
    const s = summarizePeriod([sale({ actualFee: 2 }), sale({ costBasis: 4 }), sale()], p, 13.6);
    expect(s.feesActualCount).toBe(1);
    expect(s.feesEstimatedCount).toBe(2);
    expect(s.salesWithCost).toBe(1);
    expect(s.salesMissingCost).toBe(2);
    expect(s.profitCoversAllCosts).toBe(false);
  });
  it("profit = item sales + buyer shipping - fees - refunds - labels - other - known costs", () => {
    const sales = [sale({ itemTotal: 100, shippingPaid: 10, taxPaid: 0, actualFee: 15, costBasis: 20 })];
    const when = iso(NOW - 86_400_000);
    const s = summarizePeriod(sales, p, 13.6, {
      available: true,
      refunds: [{ date: when, amount: 5 }],
      labels: [{ date: when, amount: 8 }],
      otherCharges: [{ date: when, amount: 2 }, { date: iso(p.start - 1000), amount: 999 }],
    });
    expect(s.profit).toBe(100 + 10 - 15 - 5 - 8 - 2 - 20);
    expect(s.otherCharges).toBe(2);
    expect(s.profitCoversAllCosts).toBe(true);
  });
  it("ignores Finances extras when they aren't available", () => {
    const s = summarizePeriod([sale({ actualFee: 1 })], p, 13.6, { available: false, refunds: [{ date: iso(NOW), amount: 50 }], labels: [], otherCharges: [] });
    expect(s.refunds).toBe(0);
  });
  it("average days to sell uses listing start dates and skips impossible ones", () => {
    const sold = NOW - 86_400_000;
    const s = summarizePeriod([
      sale({ soldAt: iso(sold), listedAt: iso(sold - 10 * 86_400_000) }),
      sale({ soldAt: iso(sold), listedAt: iso(sold - 4 * 86_400_000) }),
      sale({ soldAt: iso(sold), listedAt: iso(sold + 86_400_000) }), // listed after sold (relist) -> skipped
    ], p, 13.6);
    expect(s.avgDaysToSell).toBe(7);
    expect(s.salesWithDays).toBe(2);
  });
});

describe("percentChange", () => {
  it("computes up/down with one decimal", () => {
    expect(percentChange(120, 100)).toMatchObject({ pct: 20, direction: "up" });
    expect(percentChange(75, 100)).toMatchObject({ pct: -25, direction: "down" });
    expect(percentChange(100, 100)).toMatchObject({ pct: 0, direction: "flat" });
    expect(percentChange(1, 3).pct).toBe(-66.7);
  });
  it("never divides by zero", () => {
    expect(percentChange(50, 0)).toMatchObject({ pct: null, direction: "new" });
    expect(percentChange(0, 0)).toMatchObject({ pct: null, direction: "flat" });
  });
  it("sell-through = sold / (sold + active)", () => {
    expect(sellThrough(25, 75)).toBe(25);
    expect(sellThrough(0, 0)).toBeNull();
  });
});

describe("categories", () => {
  it("prefers eBay's category, then store category, then item type, then title", () => {
    expect(resolveCategory({ ebayCategory: "T-Shirts", storeCategoryName: "Tees", itemType: "Shirt", title: "x" })).toBe("T-Shirts");
    expect(resolveCategory({ ebayCategory: null, storeCategoryName: "Vintage Tees", itemType: "Shirt", title: "x" })).toBe("Vintage Tees");
    expect(resolveCategory({ ebayCategory: null, storeCategoryName: null, itemType: "Hoodie", title: "x" })).toBe("Hoodies & Sweatshirts");
    expect(resolveCategory({ ebayCategory: null, storeCategoryName: null, itemType: null, title: "Vtg 2004 LSU Tigers T-Shirt XL" })).toBe("T-Shirts & Tops");
    expect(resolveCategory({ ebayCategory: null, storeCategoryName: null, itemType: null, title: "Mystery lot" })).toBe("Other");
  });
  it("title keywords map plurals and common resale items", () => {
    expect(categoryFromText("Levi's 501 Jeans 32x30")).toBe("Jeans");
    expect(categoryFromText("Nike Air Max Sneakers 10")).toBe("Shoes");
    expect(categoryFromText("Carhartt Beanie")).toBe("Accessories");
  });
  it("breakdown shares add to ~100% and margin only uses costed sales", () => {
    const rows = categoryBreakdown([
      sale({ ebayCategory: "T-Shirts", itemTotal: 30, shippingPaid: 0, actualFee: 3, costBasis: 5 }),
      sale({ ebayCategory: "T-Shirts", itemTotal: 10, shippingPaid: 0 }),
      sale({ ebayCategory: "Jeans", itemTotal: 60, shippingPaid: 0 }),
    ], 13.6);
    expect(rows[0].category).toBe("Jeans");
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(100, 0);
    const tees = rows.find((r) => r.category === "T-Shirts")!;
    expect(tees.marginPercent).toBeCloseTo(((30 - 5 - 3) / 30) * 100, 1);
    expect(rows.find((r) => r.category === "Jeans")!.marginPercent).toBeNull();
  });
});

describe("insights", () => {
  it("builds source-more, slow-mover and missing-cost tips from real numbers", () => {
    const p = currentPeriod(30, NOW);
    const sales = [sale({ ebayCategory: "T-Shirts" }), sale({ ebayCategory: "T-Shirts" }), sale({ ebayCategory: "Jeans" })];
    const current = summarizePeriod(sales, p, 13.6);
    const previous = summarizePeriod([], previousPeriod(30, NOW), 13.6);
    const tips = buildInsights({
      days: 30, now: NOW, current, previous,
      categories: categoryBreakdown(sales, 13.6),
      active: [{ listingId: "9", title: "Old jacket", startTime: iso(NOW - 90 * 86_400_000), price: 40 }],
    });
    const kinds = tips.map((t) => t.kind);
    expect(kinds).toContain("source_more");
    expect(kinds).toContain("slow_movers");
    expect(kinds).toContain("missing_costs");
    expect(tips.find((t) => t.kind === "source_more")!.text).toMatch(/T-Shirts/);
  });
});
