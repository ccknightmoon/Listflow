import { describe, it, expect } from "vitest";
import { deriveView, currentPeriod, previousPeriod, summarizePeriod, type AnalyticsSale, type FeedForView } from "./sales-analytics";
import { extractFinanceExtras, type FinanceTx } from "./finance-match";
import { transactionWindows } from "./sales-feed";

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 17, 1, 2).getTime(); // Nov 17, 1:02am local (Sel's screenshot)
const iso = (ms: number) => new Date(ms).toISOString();

let n = 0;
function sale(soldAt: number, over: Partial<AnalyticsSale> = {}): AnalyticsSale {
  n++;
  return {
    key: `k${n}`, listingId: String(1e11 + n), title: "Tee", qty: 1, itemTotal: 40, shippingPaid: 5, taxPaid: 0,
    soldAt: iso(soldAt), listedAt: null, ebayCategory: null, storeCategoryName: null, itemType: null,
    costBasis: null, actualFee: 5, ...over,
  };
}

function feed(sales: AnalyticsSale[], over: Partial<FeedForView> = {}): FeedForView {
  return {
    sales, active: [], activeCount: 1172, feePercent: 13.6,
    finances: { available: true, refunds: [], labels: [], otherCharges: [] },
    feedStart: iso(NOW - 90 * DAY + 5 * 60_000), ...over,
  };
}

describe("previous-period comparison", () => {
  it("compares against the real previous 30 days (not the same data twice)", () => {
    const cur = currentPeriod(30, NOW);
    const prev = previousPeriod(30, NOW);
    const sales = [
      ...Array.from({ length: 78 }, (_, i) => sale(cur.start + i * 8 * 3600_000)),
      ...Array.from({ length: 50 }, (_, i) => sale(prev.start + i * 12 * 3600_000, { itemTotal: 30 })),
    ];
    const v = deriveView(feed(sales), 30, NOW);
    expect(v.current.units).toBe(78);
    expect(v.previous!.units).toBe(50);
    expect(v.changes.units!.pct).toBe(56);
    expect(v.changes.itemSales!.pct).toBe(Math.round(((78 * 40 - 50 * 30) / (50 * 30)) * 1000) / 10);
    // avg price change differs from item-sales change when unit counts differ
    expect(v.changes.avgSalePrice!.pct).not.toBe(v.changes.itemSales!.pct);
  });

  it("counts units (quantity), not sale lines", () => {
    const cur = currentPeriod(30, NOW);
    const prev = previousPeriod(30, NOW);
    const v = deriveView(feed([sale(cur.start + DAY, { qty: 3, itemTotal: 30 }), sale(prev.start + DAY)]), 30, NOW);
    expect(v.current.units).toBe(3);
    expect(v.current.orders).toBe(1);
    expect(v.changes.units!.pct).toBe(200);
  });

  it("7d and 30d previous periods fit inside eBay's 90 days; 90d does not", () => {
    expect(deriveView(feed([]), 7, NOW).previous).not.toBeNull();
    expect(deriveView(feed([]), 30, NOW).previous).not.toBeNull();
    const v90 = deriveView(feed([sale(NOW - 10 * DAY)]), 90, NOW);
    expect(v90.previous).toBeNull();
    expect(v90.changes.itemSales).toBeNull();
  });

  it("the 90d period itself starts inside the 90-day feed", () => {
    expect(currentPeriod(90, NOW).start).toBeGreaterThanOrEqual(NOW - 90 * DAY);
  });
});

describe("eBay windows", () => {
  it("covers exactly 90 days in <=30-day windows, never older than the start", () => {
    const start = NOW - 90 * DAY + 5 * 60_000;
    const w = transactionWindows(NOW, start);
    expect(w).toHaveLength(3);
    expect(Date.parse(w[w.length - 1].from)).toBe(start);
    for (const x of w) expect(Date.parse(x.to) - Date.parse(x.from)).toBeLessThanOrEqual(30 * DAY);
  });
});

describe("refunds, labels and other charges", () => {
  const t = (o: Partial<FinanceTx>): FinanceTx => ({ type: "SHIPPING_LABEL", orderId: null, date: iso(NOW), fee: 0, amount: 5, bookingEntry: "DEBIT", ...o });

  it("dates a label by its sale's date, so it lands in the same period as the sale", () => {
    const cur = currentPeriod(30, NOW);
    const soldBefore = iso(cur.start - DAY); // sold just before the 30d window
    const e = extractFinanceExtras(
      [t({ orderId: "A", date: iso(cur.start + DAY) })], // label bought inside the window
      { saleDateByOrder: new Map([["A", soldBefore]]), cancelledOrders: new Set() },
    );
    expect(e.labels[0].date).toBe(soldBefore);
    const s = summarizePeriod([], cur, 13.6, { available: true, ...e });
    expect(s.labelCosts).toBe(0); // not counted against this period
  });

  it("keeps eBay's date for charges with no matching sale", () => {
    const e = extractFinanceExtras([t({ type: "NON_SALE_CHARGE", orderId: null, date: "2026-11-01T00:00:00Z" })], { saleDateByOrder: new Map(), cancelledOrders: new Set() });
    expect(e.otherCharges[0].date).toBe("2026-11-01T00:00:00Z");
  });

  it("skips refunds for cancelled orders (never counted as sales, so no double count)", () => {
    const e = extractFinanceExtras(
      [t({ type: "REFUND", orderId: "C1", amount: 25 }), t({ type: "REFUND", orderId: "R1", amount: 10 })],
      { saleDateByOrder: new Map([["R1", iso(NOW - DAY)]]), cancelledOrders: new Set(["C1"]) },
    );
    expect(e.refunds.map((r) => r.amount)).toEqual([10]);
  });

  it("a returned (not cancelled) sale stays in item sales and its refund is subtracted once", () => {
    const sold = NOW - 2 * DAY;
    const e = extractFinanceExtras([t({ type: "REFUND", orderId: "R1", amount: 40 })], { saleDateByOrder: new Map([["R1", iso(sold)]]), cancelledOrders: new Set() });
    const s = summarizePeriod([sale(sold, { itemTotal: 40, shippingPaid: 0, actualFee: 0 })], currentPeriod(30, NOW), 13.6, { available: true, ...e });
    expect(s.itemSales).toBe(40);
    expect(s.refunds).toBe(40);
    expect(s.profit).toBe(0);
  });
});

describe("shipping loss", () => {
  it("reports buyers' shipping minus label costs and flags free-shipping sales", () => {
    const cur = currentPeriod(30, NOW);
    const sales = [sale(cur.start + DAY, { shippingPaid: 0 }), sale(cur.start + 2 * DAY, { shippingPaid: 8 })];
    const v = deriveView(feed(sales, { finances: { available: true, refunds: [], otherCharges: [], labels: [{ date: iso(cur.start + DAY), amount: 9 }, { date: iso(cur.start + 2 * DAY), amount: 9 }] } }), 30, NOW);
    expect(v.current.shippingNet).toBe(-10);
    expect(v.current.freeShippingSales).toBe(1);
    const tip = v.insights.find((i) => i.kind === "shipping_loss");
    expect(tip?.text).toMatch(/\$10\.00 more than buyers paid/);
    expect(tip?.text).toMatch(/1 of 2 sales had free shipping/);
  });
  it("no shipping figure without Finances data", () => {
    const v = deriveView(feed([sale(NOW - DAY)], { finances: { available: false, refunds: [], labels: [], otherCharges: [] } }), 30, NOW);
    expect(v.current.shippingNet).toBeNull();
  });
});
