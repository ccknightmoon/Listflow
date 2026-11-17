// All Sales-page analytics math, pure and client-safe. The page fetches
// ~180 days of sales ONCE and derives the 7/30/90-day views (and the
// previous period used for comparisons) from that single dataset here, so
// switching tabs never waits on eBay.
//
// Period definition (fixes the old off-by-one/odd-bucket behaviour):
// "Last N days" = today plus the N-1 calendar days before it, in the
// viewer's LOCAL time zone: from local midnight N-1 days ago up to now.
// The previous period is the N full local days right before that.

import { estimateEbayFee } from "./ebay-fees";
import { ITEM_TYPE_WEIGHT_TABLE } from "./shipping";

export type DayRange = 7 | 30 | 90;
const DAY_MS = 86_400_000;

export interface AnalyticsSale {
  key: string;
  listingId: string;
  title: string;
  qty: number;
  itemTotal: number;
  shippingPaid: number;
  taxPaid: number;
  soldAt: string;
  listedAt: string | null;
  ebayCategory: string | null;
  storeCategoryName: string | null;
  itemType: string | null;
  costBasis: number | null;
  /** Real fee from eBay Finances for this sale line; null = not available. */
  actualFee: number | null;
}

export interface DatedAmount {
  date: string;
  amount: number;
}

export interface PeriodBounds {
  start: number; // inclusive, ms
  end: number; // exclusive, ms
}

/** Local midnight of the day containing `ms`, shifted by `deltaDays` (DST-safe). */
export function localDayStart(ms: number, deltaDays = 0): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + deltaDays);
  return d.getTime();
}

export function currentPeriod(days: number, now: number): PeriodBounds {
  return { start: localDayStart(now, -(days - 1)), end: now + 1 };
}

export function previousPeriod(days: number, now: number): PeriodBounds {
  const cur = currentPeriod(days, now);
  return { start: localDayStart(cur.start, -days), end: cur.start };
}

export function inPeriod(dateIso: string, p: PeriodBounds): boolean {
  const t = Date.parse(dateIso);
  return !Number.isNaN(t) && t >= p.start && t < p.end;
}

// ---------------------------------------------------------------- buckets

export interface Bucket {
  start: number;
  end: number; // exclusive
  total: number;
  count: number;
  /** Covers fewer days than a full bucket (only ever the last one). */
  partial: boolean;
  days: number;
}

/**
 * 7d: one bar per local day. 30d/90d: 7-day bars starting at the period's
 * first day; the final bar holds the leftover days (30 = 4x7 + 2,
 * 90 = 12x7 + 6) and is flagged partial. Every sale in the period lands in
 * exactly one bar, so the bars always add up to the period total.
 */
export function bucketPeriod(sales: Pick<AnalyticsSale, "soldAt" | "itemTotal">[], days: number, now: number): Bucket[] {
  const period = currentPeriod(days, now);
  const step = days <= 7 ? 1 : 7;
  const buckets: Bucket[] = [];
  for (let offset = 0; offset < days; offset += step) {
    const span = Math.min(step, days - offset);
    const start = localDayStart(period.start, offset);
    const end = offset + span >= days ? period.end : localDayStart(period.start, offset + span);
    buckets.push({ start, end, total: 0, count: 0, partial: span < step, days: span });
  }
  for (const s of sales) {
    const t = Date.parse(s.soldAt);
    if (Number.isNaN(t) || t < period.start || t >= period.end) continue;
    const b = buckets.find((x) => t >= x.start && t < x.end);
    if (b) {
      b.total += s.itemTotal;
      b.count += 1;
    }
  }
  for (const b of buckets) b.total = round2(b.total);
  return buckets;
}

// ------------------------------------------------------------------- fees

/** eBay's final value fee is charged on item + shipping + tax. */
export function feeBase(s: Pick<AnalyticsSale, "itemTotal" | "shippingPaid" | "taxPaid">): number {
  return s.itemTotal + (s.shippingPaid || 0) + (s.taxPaid || 0);
}

/** Real eBay fee when Finances reported one, otherwise the estimate. */
export function chooseFee(
  s: Pick<AnalyticsSale, "itemTotal" | "shippingPaid" | "taxPaid" | "actualFee">,
  feePercent: number,
): { fee: number; actual: boolean } {
  if (typeof s.actualFee === "number" && Number.isFinite(s.actualFee) && s.actualFee >= 0) {
    return { fee: s.actualFee, actual: true };
  }
  return { fee: round2(estimateEbayFee(feeBase(s), feePercent)), actual: false };
}

// ---------------------------------------------------------------- summary

export interface PeriodSummary {
  orders: number; // sale lines
  units: number;
  itemSales: number; // excl. shipping & tax
  avgSalePrice: number | null; // itemSales / units
  shippingPaidByBuyers: number;
  taxCollected: number;
  fees: number;
  feesActualCount: number;
  feesEstimatedCount: number;
  cogs: number;
  salesWithCost: number;
  salesMissingCost: number;
  refunds: number;
  labelCosts: number;
  otherCharges: number;
  /** item sales + buyer shipping - fees - refunds - labels - other - known costs */
  profit: number;
  profitCoversAllCosts: boolean;
  avgDaysToSell: number | null;
  salesWithDays: number;
}

export interface FinanceExtras {
  available: boolean;
  refunds: DatedAmount[];
  labels: DatedAmount[];
  otherCharges: DatedAmount[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function sumIn(list: DatedAmount[], p: PeriodBounds): number {
  return list.reduce((acc, x) => (inPeriod(x.date, p) ? acc + x.amount : acc), 0);
}

export function daysToSell(s: Pick<AnalyticsSale, "soldAt" | "listedAt">): number | null {
  if (!s.listedAt) return null;
  const sold = Date.parse(s.soldAt);
  const listed = Date.parse(s.listedAt);
  if (Number.isNaN(sold) || Number.isNaN(listed) || sold < listed) return null;
  return (sold - listed) / DAY_MS;
}

export function summarizePeriod(
  allSales: AnalyticsSale[],
  p: PeriodBounds,
  feePercent: number,
  extras?: FinanceExtras,
): PeriodSummary {
  const sales = allSales.filter((s) => inPeriod(s.soldAt, p));
  let units = 0, itemSales = 0, ship = 0, tax = 0, fees = 0, feesActual = 0, cogs = 0, withCost = 0;
  let daysSum = 0, withDays = 0;
  for (const s of sales) {
    units += s.qty;
    itemSales += s.itemTotal;
    ship += s.shippingPaid || 0;
    tax += s.taxPaid || 0;
    const f = chooseFee(s, feePercent);
    fees += f.fee;
    if (f.actual) feesActual++;
    if (typeof s.costBasis === "number" && Number.isFinite(s.costBasis) && s.costBasis >= 0) {
      cogs += s.costBasis;
      withCost++;
    }
    const d = daysToSell(s);
    if (d != null) {
      daysSum += d;
      withDays++;
    }
  }
  const refunds = extras?.available ? sumIn(extras.refunds, p) : 0;
  const labelCosts = extras?.available ? sumIn(extras.labels, p) : 0;
  const otherCharges = extras?.available ? sumIn(extras.otherCharges, p) : 0;
  const profit = itemSales + ship - fees - refunds - labelCosts - otherCharges - cogs;
  return {
    orders: sales.length,
    units,
    itemSales: round2(itemSales),
    avgSalePrice: units > 0 ? round2(itemSales / units) : null,
    shippingPaidByBuyers: round2(ship),
    taxCollected: round2(tax),
    fees: round2(fees),
    feesActualCount: feesActual,
    feesEstimatedCount: sales.length - feesActual,
    cogs: round2(cogs),
    salesWithCost: withCost,
    salesMissingCost: sales.length - withCost,
    refunds: round2(refunds),
    labelCosts: round2(labelCosts),
    otherCharges: round2(otherCharges),
    profit: round2(profit),
    profitCoversAllCosts: sales.length > 0 && withCost === sales.length && Boolean(extras?.available),
    avgDaysToSell: withDays > 0 ? Math.round((daysSum / withDays) * 10) / 10 : null,
    salesWithDays: withDays,
  };
}

// ------------------------------------------------------------- comparison

export interface Change {
  current: number;
  previous: number;
  /** Percent change, or null when there's nothing to compare against. */
  pct: number | null;
  direction: "up" | "down" | "flat" | "new";
}

export function percentChange(current: number, previous: number): Change {
  if (!Number.isFinite(previous) || previous === 0) {
    return { current, previous, pct: null, direction: current > 0 ? "new" : "flat" };
  }
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
  return { current, previous, pct, direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

/**
 * Sell-through for a period = units sold / (units sold + listings still
 * active now). Approximate: eBay doesn't give historical active counts, so
 * both periods use today's active count -- labelled as approximate in UI.
 */
export function sellThrough(units: number, activeNow: number): number | null {
  const denom = units + Math.max(0, activeNow);
  return denom > 0 ? Math.round((units / denom) * 1000) / 10 : null;
}

// -------------------------------------------------------------- categories

// Friendly names for the item-type terms the app already knows.
const TERM_LABELS: Record<string, string> = {
  boot: "Boots", coat: "Coats & Jackets", parka: "Coats & Jackets", puffer: "Coats & Jackets", overcoat: "Coats & Jackets",
  trench: "Coats & Jackets", "winter jacket": "Coats & Jackets", jacket: "Coats & Jackets", blazer: "Coats & Jackets",
  bomber: "Coats & Jackets", windbreaker: "Coats & Jackets", hoodie: "Hoodies & Sweatshirts", sweatshirt: "Hoodies & Sweatshirts",
  sweater: "Sweaters", cardigan: "Sweaters", knit: "Sweaters", jeans: "Jeans", denim: "Jeans",
  pant: "Pants", trouser: "Pants", cargo: "Pants", chino: "Pants", jogger: "Pants", sweatpant: "Pants",
  shoe: "Shoes", sneaker: "Shoes", loafer: "Shoes", heel: "Shoes", flat: "Shoes", sandal: "Shoes",
  handbag: "Bags", purse: "Bags", tote: "Bags", backpack: "Bags", satchel: "Bags", crossbody: "Bags",
  dress: "Dresses", gown: "Dresses", sundress: "Dresses", skirt: "Skirts", shorts: "Shorts",
  polo: "Shirts", blouse: "Shirts", "button-up": "Shirts", "button-down": "Shirts", henley: "Shirts",
  shirt: "T-Shirts & Tops", tee: "T-Shirts & Tops", "t-shirt": "T-Shirts & Tops", top: "T-Shirts & Tops",
  jumpsuit: "Jumpsuits & Overalls", romper: "Jumpsuits & Overalls", overall: "Jumpsuits & Overalls", vest: "Vests",
  pajama: "Sleepwear", pyjama: "Sleepwear", robe: "Sleepwear", legging: "Activewear & Swim", swimsuit: "Activewear & Swim",
  bikini: "Activewear & Swim", "swim trunk": "Activewear & Swim",
  hat: "Accessories", cap: "Accessories", beanie: "Accessories", scarf: "Accessories", scarves: "Accessories",
  glove: "Accessories", mitten: "Accessories", belt: "Accessories", wallet: "Accessories", sunglass: "Accessories",
  watch: "Accessories", sock: "Accessories", tie: "Accessories", bandana: "Accessories",
  jewelry: "Jewelry", necklace: "Jewelry", bracelet: "Jewelry", earring: "Jewelry", ring: "Jewelry",
};

const TERM_MATCHERS = ITEM_TYPE_WEIGHT_TABLE.flatMap((row) =>
  row.terms.map((term) => ({
    term,
    re: new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:e?s)?\\b`, "i"),
  })),
);

export function categoryFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const hit = TERM_MATCHERS.find((m) => m.re.test(text));
  return hit ? TERM_LABELS[hit.term] ?? null : null;
}

/** eBay's category > your store category > item type > title keywords > "Other". */
export function resolveCategory(s: Pick<AnalyticsSale, "ebayCategory" | "storeCategoryName" | "itemType" | "title">): string {
  return (
    s.ebayCategory?.trim() ||
    s.storeCategoryName?.trim() ||
    categoryFromText(s.itemType) ||
    s.itemType?.trim() ||
    categoryFromText(s.title) ||
    "Other"
  );
}

export interface CategoryRow {
  category: string;
  units: number;
  revenue: number;
  share: number; // % of period item sales
  avgPrice: number;
  marginPercent: number | null; // only over sales with a cost
  salesWithCost: number;
  avgDaysToSell: number | null;
}

export function categoryBreakdown(sales: AnalyticsSale[], feePercent: number): CategoryRow[] {
  const total = sales.reduce((a, s) => a + s.itemTotal, 0);
  const groups = new Map<string, AnalyticsSale[]>();
  for (const s of sales) {
    const k = resolveCategory(s);
    const g = groups.get(k);
    if (g) g.push(s);
    else groups.set(k, [s]);
  }
  const rows: CategoryRow[] = [];
  for (const [category, list] of groups) {
    const units = list.reduce((a, s) => a + s.qty, 0);
    const revenue = list.reduce((a, s) => a + s.itemTotal, 0);
    const costed = list.filter((s) => typeof s.costBasis === "number" && s.costBasis >= 0);
    let marginPercent: number | null = null;
    if (costed.length > 0) {
      const rev = costed.reduce((a, s) => a + s.itemTotal + (s.shippingPaid || 0), 0);
      const cost = costed.reduce((a, s) => a + (s.costBasis as number) + chooseFee(s, feePercent).fee, 0);
      marginPercent = rev > 0 ? Math.round(((rev - cost) / rev) * 1000) / 10 : null;
    }
    const days = list.map(daysToSell).filter((d): d is number => d != null);
    rows.push({
      category,
      units,
      revenue: round2(revenue),
      share: total > 0 ? Math.round((revenue / total) * 1000) / 10 : 0,
      avgPrice: units > 0 ? round2(revenue / units) : 0,
      marginPercent,
      salesWithCost: costed.length,
      avgDaysToSell: days.length ? Math.round((days.reduce((a, d) => a + d, 0) / days.length) * 10) / 10 : null,
    });
  }
  return rows.sort((a, b) => b.revenue - a.revenue);
}

export function topSales(sales: AnalyticsSale[], n = 5): AnalyticsSale[] {
  return [...sales].sort((a, b) => b.itemTotal - a.itemTotal).slice(0, n);
}

// ---------------------------------------------------------------- insights

export interface ActiveListing {
  listingId: string;
  title: string;
  startTime: string | null;
  price: number | null;
}

export interface Insight {
  kind: "source_more" | "fast_mover" | "slow_movers" | "missing_costs" | "price_trend" | "no_sales";
  text: string;
}

export const SLOW_MOVER_DAYS = 60;

export function buildInsights(input: {
  days: number;
  now: number;
  current: PeriodSummary;
  previous: PeriodSummary;
  categories: CategoryRow[];
  active: ActiveListing[];
}): Insight[] {
  const { current, previous, categories, active, now } = input;
  const out: Insight[] = [];
  if (current.orders === 0) {
    out.push({ kind: "no_sales", text: `No sales in the last ${input.days} days yet — list more to give buyers something new to find.` });
  }
  const best = categories[0];
  if (best && best.units >= 2) {
    out.push({
      kind: "source_more",
      text: `${best.category} is your top seller: ${best.units} sold, ${best.share}% of item sales. Source more of it.`,
    });
  }
  const fast = categories
    .filter((c) => c.avgDaysToSell != null && c.units >= 3)
    .sort((a, b) => (a.avgDaysToSell as number) - (b.avgDaysToSell as number))[0];
  if (fast && fast.avgDaysToSell != null) {
    out.push({ kind: "fast_mover", text: `${fast.category} sells fastest — about ${Math.round(fast.avgDaysToSell)} days from listing to sale.` });
  }
  const slow = active.filter((a) => {
    if (!a.startTime) return false;
    const t = Date.parse(a.startTime);
    return !Number.isNaN(t) && (now - t) / DAY_MS >= SLOW_MOVER_DAYS;
  });
  if (slow.length > 0) {
    out.push({
      kind: "slow_movers",
      text: `${slow.length} listing${slow.length === 1 ? " has" : "s have"} been live ${SLOW_MOVER_DAYS}+ days without selling — try a price drop, an offer to watchers, or new photos.`,
    });
  }
  if (current.salesMissingCost > 0) {
    out.push({
      kind: "missing_costs",
      text: `${current.salesMissingCost} of ${current.orders} sales have no item cost — add costs to see your real profit and margins.`,
    });
  }
  const price = percentChange(current.avgSalePrice ?? 0, previous.avgSalePrice ?? 0);
  if (price.pct != null && Math.abs(price.pct) >= 10) {
    out.push({
      kind: "price_trend",
      text: `Average sale price is ${price.pct > 0 ? "up" : "down"} ${Math.abs(price.pct)}% vs the previous ${input.days} days ($${(current.avgSalePrice ?? 0).toFixed(2)} vs $${(previous.avgSalePrice ?? 0).toFixed(2)}).`,
    });
  }
  return out;
}

// ------------------------------------------------------------ whole view

export interface FeedForView {
  sales: AnalyticsSale[];
  finances: FinanceExtras;
  active: ActiveListing[];
  activeCount: number | null;
  feePercent: number;
}

export interface SalesView {
  days: number;
  period: PeriodBounds;
  previousBounds: PeriodBounds;
  sales: AnalyticsSale[]; // in period, newest first
  current: PeriodSummary;
  previous: PeriodSummary;
  changes: { itemSales: Change; units: Change; avgSalePrice: Change; sellThrough: Change | null };
  sellThroughNow: number | null;
  buckets: Bucket[];
  categories: CategoryRow[];
  top: AnalyticsSale[];
  insights: Insight[];
}

/** Everything the Sales page shows for one tab, from the single cached feed. */
export function deriveView(feed: FeedForView, days: number, now: number): SalesView {
  const period = currentPeriod(days, now);
  const previousBounds = previousPeriod(days, now);
  const sales = feed.sales
    .filter((s) => inPeriod(s.soldAt, period))
    .sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt));
  const current = summarizePeriod(feed.sales, period, feed.feePercent, feed.finances);
  const previous = summarizePeriod(feed.sales, previousBounds, feed.feePercent, feed.finances);
  const activeNow = feed.activeCount ?? feed.active.length;
  const stNow = feed.activeCount == null && feed.active.length === 0 ? null : sellThrough(current.units, activeNow);
  const stPrev = stNow == null ? null : sellThrough(previous.units, activeNow);
  const categories = categoryBreakdown(sales, feed.feePercent);
  return {
    days,
    period,
    previousBounds,
    sales,
    current,
    previous,
    changes: {
      itemSales: percentChange(current.itemSales, previous.itemSales),
      units: percentChange(current.units, previous.units),
      avgSalePrice: percentChange(current.avgSalePrice ?? 0, previous.avgSalePrice ?? 0),
      sellThrough: stNow == null || stPrev == null ? null : percentChange(stNow, stPrev),
    },
    sellThroughNow: stNow,
    buckets: bucketPeriod(sales, days, now),
    categories,
    top: topSales(sales, 5),
    insights: buildInsights({ days, now, current, previous, categories, active: feed.active }),
  };
}
