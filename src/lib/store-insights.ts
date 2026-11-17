// "Improve the store" analytics for the Sales page. Pure, integer cents,
// unit-tested. Money per sale uses eBay's real fee where Finances matched
// one, eBay labels matched to the order, and the seller's own cost.

import { normalizeOrderId } from "./finance-match";
import { chooseFee, daysToSell, resolveCategory, toC, type ActiveListing, type AnalyticsSale, type Bucket } from "./sales-analytics";
import type { LedgerTx, PeriodRange } from "./ledger";
import { inRange } from "./ledger";

const DAY_MS = 86_400_000;

/** Label cost (cents, positive) per normalized order id, for labels dated in the period. */
export function labelCentsByOrder(ledger: LedgerTx[], p: PeriodRange): { byOrder: Map<string, number>; unlinked: number } {
  const byOrder = new Map<string, number>();
  let unlinked = 0;
  for (const t of ledger) {
    if (t.type !== "SHIPPING_LABEL" || !inRange(t, p)) continue;
    const cost = -t.amountCents; // debit -> positive cost; label refunds reduce it
    const id = normalizeOrderId(t.orderId);
    if (id) byOrder.set(id, (byOrder.get(id) ?? 0) + cost);
    else unlinked += cost;
  }
  return { byOrder, unlinked };
}

// ------------------------------------------------------------ per sale

export interface SaleEconomics {
  key: string;
  title: string;
  category: string;
  grossCents: number; // item + buyer-paid shipping
  feeCents: number;
  feeActual: boolean;
  labelCents: number; // eBay labels for this order (0 if none / bought elsewhere)
  costCents: number | null; // null = not entered
  netCents: number; // gross - fee - label - (cost ?? 0)
  freeShipping: boolean;
  days: number | null;
}

/**
 * Per-sale money. A multi-line order's label is charged to its first line
 * only, so label totals are never double-counted.
 */
export function saleEconomics(sales: AnalyticsSale[], ledger: LedgerTx[], p: PeriodRange, feePercent: number): SaleEconomics[] {
  const { byOrder } = labelCentsByOrder(ledger, p);
  const used = new Set<string>();
  return sales.map((s) => {
    const fee = chooseFee(s, feePercent);
    const id = normalizeOrderId(s.orderId);
    let label = 0;
    if (id && byOrder.has(id) && !used.has(id)) {
      label = byOrder.get(id) as number;
      used.add(id);
    }
    const gross = toC(s.itemTotal) + toC(s.shippingPaid);
    const cost = typeof s.costBasis === "number" && s.costBasis >= 0 ? toC(s.costBasis) : null;
    return {
      key: s.key,
      title: s.title,
      category: resolveCategory(s),
      grossCents: gross,
      feeCents: toC(fee.fee),
      feeActual: fee.actual,
      labelCents: label,
      costCents: cost,
      netCents: gross - toC(fee.fee) - label - (cost ?? 0),
      freeShipping: !(s.shippingPaid > 0),
      days: daysToSell(s),
    };
  });
}

// ------------------------------------------------------------ shipping

export interface ShippingGroup {
  sales: number;
  buyerPaidCents: number;
  labelCents: number;
  netCents: number; // buyer paid - labels
}

export interface ShippingSplit {
  free: ShippingGroup;
  calculated: ShippingGroup;
  /** eBay labels in the period not linked to any sale shown (other periods, bought before the sale was listed here, etc.) */
  unlinkedLabelCents: number;
}

export function shippingSplit(sales: AnalyticsSale[], ledger: LedgerTx[], p: PeriodRange, feePercent: number): ShippingSplit {
  const econ = saleEconomics(sales, ledger, p, feePercent);
  const g = (): ShippingGroup => ({ sales: 0, buyerPaidCents: 0, labelCents: 0, netCents: 0 });
  const free = g(), calculated = g();
  econ.forEach((e, i) => {
    const grp = e.freeShipping ? free : calculated;
    grp.sales++;
    grp.buyerPaidCents += toC(sales[i].shippingPaid);
    grp.labelCents += e.labelCents;
  });
  for (const grp of [free, calculated]) grp.netCents = grp.buyerPaidCents - grp.labelCents;
  const { byOrder, unlinked } = labelCentsByOrder(ledger, p);
  const linked = econ.reduce((a, e) => a + e.labelCents, 0);
  const allLabels = [...byOrder.values()].reduce((a, c) => a + c, 0) + unlinked;
  return { free, calculated, unlinkedLabelCents: allLabels - linked };
}

// ---------------------------------------------------------- categories

export interface CategoryProfit {
  category: string;
  units: number;
  grossCents: number;
  feeCents: number;
  labelCents: number;
  costCents: number;
  salesWithCost: number;
  netCents: number; // gross - fees - labels - known costs
  marginPercent: number | null; // net / gross, only when every sale has a cost
  netPerItemCents: number;
  avgDaysToSell: number | null;
}

export function categoryProfit(sales: AnalyticsSale[], econ: SaleEconomics[]): CategoryProfit[] {
  const map = new Map<string, CategoryProfit & { daysSum: number; daysN: number }>();
  econ.forEach((e, i) => {
    let row = map.get(e.category);
    if (!row) {
      row = { category: e.category, units: 0, grossCents: 0, feeCents: 0, labelCents: 0, costCents: 0, salesWithCost: 0, netCents: 0, marginPercent: null, netPerItemCents: 0, avgDaysToSell: null, daysSum: 0, daysN: 0 };
      map.set(e.category, row);
    }
    row.units += sales[i].qty;
    row.grossCents += e.grossCents;
    row.feeCents += e.feeCents;
    row.labelCents += e.labelCents;
    if (e.costCents != null) { row.costCents += e.costCents; row.salesWithCost++; }
    row.netCents += e.netCents;
    if (e.days != null) { row.daysSum += e.days; row.daysN++; }
  });
  const counts = new Map<string, number>();
  econ.forEach((e) => counts.set(e.category, (counts.get(e.category) ?? 0) + 1));
  return [...map.values()].map(({ daysSum, daysN, ...r }) => ({
    ...r,
    marginPercent: r.salesWithCost === counts.get(r.category) && r.grossCents > 0 ? Math.round((r.netCents / r.grossCents) * 1000) / 10 : null,
    netPerItemCents: r.units > 0 ? Math.round(r.netCents / r.units) : 0,
    avgDaysToSell: daysN > 0 ? Math.round((daysSum / daysN) * 10) / 10 : null,
  })).sort((a, b) => b.netCents - a.netCents);
}

// ---------------------------------------------------- best / worst items

export function bestAndWorst(econ: SaleEconomics[], n = 3): { best: SaleEconomics[]; worst: SaleEconomics[] } {
  const sorted = [...econ].sort((a, b) => b.netCents - a.netCents);
  const best = sorted.slice(0, n);
  const worst = sorted.slice(-n).reverse().filter((w) => !best.includes(w));
  return { best, worst };
}

// ------------------------------------------------- sell-through trend

/** Units sold per bar / (units + active listings now), as %. Approximate (today's active count). */
export function sellThroughTrend(buckets: Bucket[], activeNow: number): number[] {
  return buckets.map((b) => {
    const d = b.units + Math.max(0, activeNow);
    return d > 0 ? Math.round((b.units / d) * 1000) / 10 : 0;
  });
}

// ------------------------------------------------------- stale listings

export interface StaleReport {
  bands: { label: string; count: number }[];
  oldest: Array<ActiveListing & { daysLive: number }>;
  staleCount: number; // 60+ days
}

export function staleListings(active: ActiveListing[], now: number, threshold = 60): StaleReport {
  const withAge = active
    .map((a) => ({ ...a, daysLive: a.startTime ? Math.floor((now - Date.parse(a.startTime)) / DAY_MS) : -1 }))
    .filter((a) => a.daysLive >= 0);
  const band = (lo: number, hi: number) => withAge.filter((a) => a.daysLive >= lo && a.daysLive < hi).length;
  return {
    bands: [
      { label: "< 30 days", count: band(0, 30) },
      { label: "30–59 days", count: band(30, 60) },
      { label: "60–89 days", count: band(60, 90) },
      { label: "90+ days", count: band(90, Infinity) },
    ],
    oldest: withAge.filter((a) => a.daysLive >= threshold).sort((a, b) => b.daysLive - a.daysLive).slice(0, 5),
    staleCount: withAge.filter((a) => a.daysLive >= threshold).length,
  };
}

// --------------------------------------------------------------- tips

export interface StoreTip {
  kind: "source_more" | "fast_mover" | "low_margin" | "stale" | "missing_costs" | "calculated_shipping" | "losers";
  text: string;
}

const $ = (c: number) => `$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Actionable tips only. Legacy free-shipping listings are a deliberate
 * choice, so their shipping cost is reported (in the shipping split) but
 * never turned into a tip.
 */
export function storeTips(input: {
  categories: CategoryProfit[];
  econ: SaleEconomics[];
  shipping: ShippingSplit;
  stale: StaleReport;
}): StoreTip[] {
  const { categories, econ, shipping, stale } = input;
  const tips: StoreTip[] = [];
  const best = categories.find((c) => c.units >= 2);
  if (best && best.netCents > 0) {
    tips.push({ kind: "source_more", text: `${best.category} earns you the most: ${$(best.netCents)} after eBay costs from ${best.units} sold (${$(best.netPerItemCents)} per item). Source more of it.` });
  }
  const fast = categories.filter((c) => c.avgDaysToSell != null && c.units >= 3).sort((a, b) => (a.avgDaysToSell as number) - (b.avgDaysToSell as number))[0];
  if (fast) tips.push({ kind: "fast_mover", text: `${fast.category} sells fastest — about ${Math.round(fast.avgDaysToSell as number)} days from listing to sale.` });
  const weak = categories.filter((c) => c.units >= 3 && c.netPerItemCents < 1000).sort((a, b) => a.netPerItemCents - b.netPerItemCents)[0];
  if (weak && weak !== best) {
    tips.push({ kind: "low_margin", text: `${weak.category} only leaves ${$(weak.netPerItemCents)} per item after eBay costs — raise prices or source it cheaper.` });
  }
  const losers = econ.filter((e) => e.netCents < 0);
  if (losers.length > 0) {
    tips.push({ kind: "losers", text: `${losers.length} sale${losers.length !== 1 ? "s" : ""} lost money after fees, labels and costs (${$(losers.reduce((a, e) => a + e.netCents, 0))}). See "Worst sales" below.` });
  }
  if (shipping.calculated.sales >= 3 && shipping.calculated.netCents < -500) {
    tips.push({ kind: "calculated_shipping", text: `Calculated-shipping orders cost ${$(shipping.calculated.netCents)} more in labels than buyers paid — check the package weights and sizes on those listings.` });
  }
  if (stale.staleCount > 0) {
    tips.push({ kind: "stale", text: `${stale.staleCount} listing${stale.staleCount !== 1 ? "s have" : " has"} been live 60+ days without selling — try a price drop, an offer to watchers, or fresh photos.` });
  }
  const missing = econ.filter((e) => e.costCents == null).length;
  if (missing > 0) tips.push({ kind: "missing_costs", text: `${missing} of ${econ.length} sales have no item cost — add them to see true profit and margins.` });
  return tips;
}
