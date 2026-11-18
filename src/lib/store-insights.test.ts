import { describe, it, expect } from "vitest";
import { saleEconomics, shippingSplit, categoryProfit, bestAndWorst, sellThroughTrend, staleListings, storeTips, labelCentsByOrder } from "./store-insights";
import { deriveView, currentPeriod, toC, type AnalyticsSale, type FeedForView } from "./sales-analytics";
import { buildLedger, parseLedgerTx, type LedgerTx } from "./ledger";

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 17, 1, 2).getTime();
const P = currentPeriod(30, NOW);
const iso = (ms: number) => new Date(ms).toISOString();
let n = 0;

function sale(o: Partial<AnalyticsSale> = {}): AnalyticsSale {
  n++;
  return {
    key: `s${n}`, listingId: String(1e11 + n), title: "Vintage Tee", qty: 1, itemTotal: 30, shippingPaid: 7.5, taxPaid: 2.1,
    soldAt: iso(P.start + (n % 200) * 3 * 3600_000), bookedAt: null, orderId: `O${n}`, listedAt: iso(P.start - 10 * DAY),
    ebayCategory: null, storeCategoryName: null, itemType: null, costBasis: null, actualFee: 4.33, ...o,
  };
}
const label = (orderId: string | null, amt: string, at = P.start + DAY): LedgerTx =>
  parseLedgerTx({ transactionId: `L${++n}`, transactionType: "SHIPPING_LABEL", transactionStatus: "PAYOUT", transactionDate: iso(at), orderId: orderId ?? undefined, bookingEntry: "DEBIT", amount: { value: amt } });

// A realistic mixed month: tees, jeans, hoodies, free + calculated shipping, some costs, odd cents.
function month() {
  const sales: AnalyticsSale[] = [];
  const ledger: LedgerTx[] = [];
  for (let i = 0; i < 60; i++) {
    const free = i % 4 === 0;
    const s = sale({
      title: ["Nike Tee L", "Levi's 501 Jeans", "Carhartt Hoodie", "Mystery lot"][i % 4],
      itemTotal: 17.99 + (i % 9) * 3.37,
      shippingPaid: free ? 0 : 6.49 + (i % 3),
      qty: i % 11 === 0 ? 2 : 1,
      costBasis: i % 5 === 0 ? 3.5 : null,
      actualFee: i % 3 === 0 ? null : 3.07 + (i % 5) * 0.31,
    });
    sales.push(s);
    if (i % 6 !== 5) ledger.push(label(s.orderId!, (5.11 + (i % 4) * 1.03).toFixed(2), Date.parse(s.soldAt)));
  }
  ledger.push(label(null, "4.40")); // a label not tied to any sale
  return { sales, ledger };
}

describe("everything adds up (integer cents)", () => {
  const { sales, ledger } = month();
  const econ = saleEconomics(sales, ledger, P, 13.6);
  const cats = categoryProfit(sales, econ);

  it("category gross / fees / labels / net add up to the sale totals", () => {
    const sum = (k: "grossCents" | "feeCents" | "labelCents" | "netCents") => econ.reduce((a, e) => a + e[k], 0);
    expect(cats.reduce((a, c) => a + c.grossCents, 0)).toBe(sum("grossCents"));
    expect(cats.reduce((a, c) => a + c.feeCents, 0)).toBe(sum("feeCents"));
    expect(cats.reduce((a, c) => a + c.labelCents, 0)).toBe(sum("labelCents"));
    expect(cats.reduce((a, c) => a + c.netCents, 0)).toBe(sum("netCents"));
    expect(cats.reduce((a, c) => a + c.units, 0)).toBe(sales.reduce((a, s) => a + s.qty, 0));
  });

  it("each sale's net = gross - fee - label - cost", () => {
    for (const e of econ) expect(e.netCents).toBe(e.grossCents - e.feeCents - e.labelCents - (e.costCents ?? 0));
  });

  it("shipping split + unlinked labels = every eBay label in the period", () => {
    const sp = shippingSplit(sales, ledger, P, 13.6);
    const allLabels = -buildLedger(ledger, P).lines.find((l) => l.key === "labels")!.cents;
    expect(sp.free.labelCents + sp.calculated.labelCents + sp.unlinkedLabelCents).toBe(allLabels);
    expect(sp.free.sales + sp.calculated.sales).toBe(sales.length);
    expect(sp.free.buyerPaidCents).toBe(0);
    expect(sp.calculated.buyerPaidCents).toBe(sales.reduce((a, s) => a + toC(s.shippingPaid), 0));
  });

  it("KPI tiles, chart bars and category table agree on the same totals", () => {
    const feed: FeedForView = { sales, active: [], activeCount: 100, feePercent: 13.6, finances: { available: true, refunds: [], labels: [], otherCharges: [] } };
    const v = deriveView(feed, 30, NOW);
    const barsC = v.buckets.reduce((a, b) => a + toC(b.total), 0);
    expect(barsC).toBe(toC(v.current.itemSales));
    expect(v.buckets.reduce((a, b) => a + b.units, 0)).toBe(v.current.units);
    expect(v.categories.reduce((a, c) => a + toC(c.revenue), 0)).toBe(toC(v.current.itemSales));
    expect(v.categories.reduce((a, c) => a + c.units, 0)).toBe(v.current.units);
  });

  it("a multi-line order's label is charged once", () => {
    const a = sale({ orderId: "MULTI" }), b = sale({ orderId: "MULTI" });
    const e = saleEconomics([a, b], [label("MULTI", "9.00")], P, 13.6);
    expect(e[0].labelCents + e[1].labelCents).toBe(900);
  });
});

describe("eBay transaction date is the date basis", () => {
  it("a sale ordered before the period but paid (booked by eBay) inside it counts in the period", () => {
    const s = sale({ soldAt: iso(P.start - 2 * 3600_000), bookedAt: iso(P.start + 3600_000) });
    const v = deriveView({ sales: [s], active: [], activeCount: 0, feePercent: 13.6, finances: { available: false, refunds: [], labels: [], otherCharges: [] } }, 30, NOW);
    expect(v.current.orders).toBe(1);
  });
});

describe("labels by order", () => {
  it("label refunds (credits) reduce the order's label cost", () => {
    const credit = parseLedgerTx({ transactionId: "c", transactionType: "SHIPPING_LABEL", transactionDate: iso(P.start + DAY), orderId: "Z", bookingEntry: "CREDIT", amount: { value: "2.00" } });
    expect(labelCentsByOrder([label("Z", "7.00"), credit], P).byOrder.get("Z")).toBe(500);
  });
});

describe("best / worst, sell-through trend, stale listings", () => {
  it("best are highest net, worst lowest (no overlap)", () => {
    const { sales, ledger } = month();
    const econ = saleEconomics(sales, ledger, P, 13.6);
    const { best, worst } = bestAndWorst(econ);
    expect(best[0].netCents).toBe(Math.max(...econ.map((e) => e.netCents)));
    expect(worst[0].netCents).toBe(Math.min(...econ.map((e) => e.netCents)));
    expect(best.some((b) => worst.includes(b))).toBe(false);
  });
  it("sell-through per bar uses units / (units + active)", () => {
    expect(sellThroughTrend([{ units: 10 }, { units: 0 }] as never, 90)).toEqual([10, 0]);
  });
  it("stale bands add up to all dated active listings", () => {
    const active = [0, 10, 45, 61, 75, 120, 400].map((d, i) => ({ listingId: String(i), title: `L${i}`, price: 10, startTime: iso(NOW - d * DAY - 1000) }));
    const r = staleListings([...active, { listingId: "x", title: "no date", price: 1, startTime: null }], NOW);
    expect(r.bands.reduce((a, b) => a + b.count, 0)).toBe(7);
    expect(r.staleCount).toBe(4);
    expect(r.oldest[0].daysLive).toBe(400);
  });
});

describe("tips are actionable and never nag about legacy free shipping", () => {
  it("free-shipping label losses are not a tip; calculated-shipping losses are", () => {
    const freeOnly = Array.from({ length: 5 }, () => sale({ shippingPaid: 0 }));
    const led = freeOnly.map((s) => label(s.orderId!, "9.00", Date.parse(s.soldAt)));
    const econ = saleEconomics(freeOnly, led, P, 13.6);
    const tips = storeTips({ categories: categoryProfit(freeOnly, econ), econ, shipping: shippingSplit(freeOnly, led, P, 13.6), stale: staleListings([], NOW) });
    expect(tips.map((t) => t.kind)).not.toContain("calculated_shipping");

    const calc = Array.from({ length: 5 }, () => sale({ shippingPaid: 4 }));
    const led2 = calc.map((s) => label(s.orderId!, "9.00", Date.parse(s.soldAt)));
    const econ2 = saleEconomics(calc, led2, P, 13.6);
    const tips2 = storeTips({ categories: categoryProfit(calc, econ2), econ: econ2, shipping: shippingSplit(calc, led2, P, 13.6), stale: staleListings([], NOW) });
    expect(tips2.find((t) => t.kind === "calculated_shipping")?.text).toMatch(/\$25\.00/);
  });
});

import { activeCountAt, exactSellThroughTrend } from "./store-insights";
describe("exact sell-through from daily snapshots", () => {
  const snaps = [
    { date: "2026-11-01", activeCount: 1100, capturedAt: "2026-11-01T07:30:00Z" },
    { date: "2026-11-08", activeCount: 1180, capturedAt: "2026-11-08T07:30:00Z" },
  ];
  it("uses the count recorded just before the period end, never a guess", () => {
    expect(activeCountAt(snaps, Date.parse("2026-11-01T20:00:00Z"))).toBe(1100);
    expect(activeCountAt(snaps, Date.parse("2026-11-05T00:00:00Z"))).toBeNull(); // nothing within 36h
    expect(activeCountAt(null, Date.now())).toBeNull();
  });
  it("trend is null unless every bar has a recorded count", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    const bars = [
      { start: 0, end: Date.parse("2026-11-01T23:00:00Z"), units: 10 },
      { start: 0, end: now + 1, units: 20 },
    ] as never;
    expect(exactSellThroughTrend(bars, snaps, 1200, now)).toEqual([Math.round((10 / 1110) * 1000) / 10, Math.round((20 / 1220) * 1000) / 10]);
    expect(exactSellThroughTrend(bars, [], 1200, now)).toBeNull();
  });
});

import { collapseCategories, categoryProfit as _cp } from "./store-insights";
import { resolveCategory as _rc } from "./sales-analytics";
describe("category table adds up to every sale", () => {
  const row = (category: string, units: number, netCents = units * 100) => ({ category, units, grossCents: units * 1000, feeCents: 0, labelCents: 0, costCents: 0, salesWithCost: 0, netCents, marginPercent: null, netPerItemCents: 100, avgDaysToSell: null });
  it("rolls everything past the top 7 into one row, keeping totals", () => {
    const rows = Array.from({ length: 11 }, (_, i) => row(`C${i}`, 11 - i)); // 66 units
    const out = collapseCategories(rows, 8);
    expect(out).toHaveLength(8);
    expect(out[7].category).toBe("All other (4)");
    expect(out.reduce((a, r) => a + r.units, 0)).toBe(rows.reduce((a, r) => a + r.units, 0));
    expect(out.reduce((a, r) => a + r.netCents, 0)).toBe(rows.reduce((a, r) => a + r.netCents, 0));
  });
  it("leaves short tables alone", () => {
    const rows = [row("Jackets", 3), row("Other", 1)];
    expect(collapseCategories(rows, 8)).toBe(rows);
  });
  it("a sale with no category info still lands in 'Other'", () => {
    expect(_rc({ ebayCategory: null, storeCategoryName: null, itemType: null, title: "Mystery lot" })).toBe("Other");
    void _cp;
  });
});
