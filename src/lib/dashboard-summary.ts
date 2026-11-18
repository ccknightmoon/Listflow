// One server-side summary for the Dashboard (Nov 2026 audit, P2).
//
// The Dashboard used to fire 6 separate eBay-backed requests on every visit
// (stats, ship, 28-day sales, offers, messages, and the whole store just to
// count stale listings). This module computes all of it in one request with
// the cheapest eBay call for each number, and caches the result per seller
// for a couple of minutes so flipping back to the Dashboard is instant and
// costs no eBay calls.
import { tradingRequest } from "@/lib/ebay-inventory";
import { extractItemBlocks, xmlFind, xmlFindAll } from "@/lib/ebay-listings";
import { fetchUnshippedOrders } from "@/lib/ebay-ship-orders";
import { countPendingOffers } from "@/lib/ebay-offers";
import { fetchUnansweredQuestions } from "@/lib/ebay-messages";
import { STALE_DAYS_THRESHOLD } from "@/lib/stale-listings";
import type { BucketableSale } from "@/lib/sales-buckets";

export const SUMMARY_TTL_MS = 120_000;
export const TREND_DAYS = 28;
const DAY_MS = 86_400_000;

export interface DashboardSummary {
  active: number | null;
  weeklyRevenue: number | null;
  weeklySales: number | null;
  trendSales: BucketableSale[] | null;
  shipCount: number | null;
  pendingOffers: number | null;
  buyerQuestions: number | null;
  staleListings: number | null;
  generatedAt: string;
}

const ok = (body: string) => body.includes("<Ack>Success</Ack>") || body.includes("<Ack>Warning</Ack>");

// ---------------------------------------------------------------- sales --

/** Sales (by real sale date, not ModTime) inside the window, from one GetSellerTransactions page. */
export function parseTrendSales(body: string, sinceMs: number): BucketableSale[] {
  const out: BucketableSale[] = [];
  for (const tx of xmlFindAll(body, "Transaction")) {
    const price = parseFloat(xmlFind(tx, "TransactionPrice") || "0");
    const qty = parseInt(xmlFind(tx, "QuantityPurchased") || "1", 10) || 1;
    const soldAt = xmlFind(tx, "CreatedDate");
    const t = Date.parse(soldAt);
    if (price > 0 && Number.isFinite(t) && t >= sinceMs) out.push({ soldAt, total: price * qty });
  }
  return out;
}

/** This week's revenue and units sold, by real sale date. */
export function weeklyFromTrend(body: string[], nowMs: number): { revenue: number; sales: number } {
  const since = nowMs - 7 * DAY_MS;
  let revenue = 0;
  let sales = 0;
  for (const b of body) {
    for (const tx of xmlFindAll(b, "Transaction")) {
      const price = parseFloat(xmlFind(tx, "TransactionPrice") || "0");
      const qty = parseInt(xmlFind(tx, "QuantityPurchased") || "1", 10) || 1;
      const t = Date.parse(xmlFind(tx, "CreatedDate"));
      if (price > 0 && Number.isFinite(t) && t >= since) {
        revenue += price * qty;
        sales += qty;
      }
    }
  }
  return { revenue, sales };
}

function salesXml(from: string, to: string, page: number) {
  return `<?xml version="1.0" encoding="utf-8"?><GetSellerTransactionsRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ModTimeFrom>${from}</ModTimeFrom><ModTimeTo>${to}</ModTimeTo><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></GetSellerTransactionsRequest>`;
}

async function fetchSalesPages(nowMs: number): Promise<string[] | null> {
  const from = new Date(nowMs - TREND_DAYS * DAY_MS).toISOString();
  const to = new Date(nowMs).toISOString();
  const first = await tradingRequest("GetSellerTransactions", salesXml(from, to, 1));
  if (!ok(first.body)) return null;
  const pages = Math.min(parseInt(xmlFind(xmlFind(first.body, "PaginationResult"), "TotalNumberOfPages") || "1", 10) || 1, 10);
  const bodies = [first.body];
  for (let p = 2; p <= pages; p++) {
    const r = await tradingRequest("GetSellerTransactions", salesXml(from, to, p));
    if (ok(r.body)) bodies.push(r.body);
  }
  return bodies;
}

// ---------------------------------------------------------------- stale --
//
// Stale = active and started 30+ days ago. Instead of pulling every active
// listing (~1,300 → 7 big pages), ask eBay for the active list sorted
// oldest-first in small pages and binary-search for the first listing that
// is NOT stale. Its position is the stale count. ~6-7 tiny calls.

const STALE_PAGE_SIZE = 25;

export interface SortedPage {
  total: number;
  startTimes: Array<string | null>;
}

function activeSortedXml(page: number) {
  return `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Sort>StartTime</Sort><Pagination><EntriesPerPage>${STALE_PAGE_SIZE}</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList><DetailLevel>ReturnSummary</DetailLevel></GetMyeBaySellingRequest>`;
}

export function parseSortedPage(body: string): SortedPage | null {
  if (!ok(body)) return null;
  const list = xmlFind(body, "ActiveList") || body;
  const total = parseInt(xmlFind(xmlFind(list, "PaginationResult"), "TotalNumberOfEntries") || "0", 10) || 0;
  const startTimes = extractItemBlocks(list).map((it) => xmlFind(xmlFind(it, "ListingDetails"), "StartTime") || xmlFind(it, "StartTime") || null);
  return { total, startTimes };
}

/**
 * Counts stale listings given a fetcher for oldest-first pages (1-based).
 * Returns null if a page can't be read or eBay didn't actually sort.
 */
export async function countStaleSorted(
  fetchPage: (page: number) => Promise<SortedPage | null>,
  cutoffMs: number,
  pageSize = STALE_PAGE_SIZE,
): Promise<number | null> {
  const isOld = (s: string | null) => {
    const t = s ? Date.parse(s) : NaN;
    return Number.isFinite(t) && t <= cutoffMs;
  };
  const sorted = (p: SortedPage) =>
    p.startTimes.every((s, i) => i === 0 || !s || !p.startTimes[i - 1] || Date.parse(p.startTimes[i - 1]!) <= Date.parse(s));

  const first = await fetchPage(1);
  if (!first || !sorted(first)) return null;
  if (first.total === 0 || first.startTimes.length === 0) return 0;
  const pages = Math.ceil(first.total / pageSize);
  const cache = new Map<number, SortedPage>([[1, first]]);
  const get = async (p: number) => {
    if (!cache.has(p)) {
      const r = await fetchPage(p);
      if (!r || !sorted(r)) return null;
      cache.set(p, r);
    }
    return cache.get(p)!;
  };

  // Find the first page whose LAST item is not stale.
  let lo = 1;
  let hi = pages;
  let target = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const p = await get(mid);
    if (!p) return null;
    const last = p.startTimes[p.startTimes.length - 1] ?? null;
    if (p.startTimes.length && isOld(last)) {
      lo = mid + 1;
    } else {
      target = mid;
      hi = mid - 1;
    }
  }
  if (target === -1) return first.total; // every listing is stale
  const p = (await get(target))!;
  const within = p.startTimes.findIndex((s) => !isOld(s));
  return (target - 1) * pageSize + (within === -1 ? p.startTimes.length : within);
}

async function fetchStaleCount(nowMs: number): Promise<number | null> {
  const cutoff = nowMs - STALE_DAYS_THRESHOLD * DAY_MS;
  return countStaleSorted(async (page) => {
    const r = await tradingRequest("GetMyeBaySelling", activeSortedXml(page));
    return parseSortedPage(r.body);
  }, cutoff);
}

// --------------------------------------------------------------- active --

async function fetchActiveCount(): Promise<number | null> {
  const r = await tradingRequest(
    "GetMyeBaySelling",
    `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Pagination><EntriesPerPage>1</EntriesPerPage><PageNumber>1</PageNumber></Pagination></ActiveList></GetMyeBaySellingRequest>`,
  );
  if (!ok(r.body)) return null;
  const n = parseInt(xmlFind(r.body, "TotalNumberOfEntries") || "0", 10);
  return Number.isFinite(n) ? n : null;
}

// -------------------------------------------------------------- summary --

const settled = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);

export async function buildDashboardSummary(nowMs = Date.now()): Promise<DashboardSummary> {
  const [active, salesBodies, ship, offers, questions, stale] = await Promise.allSettled([
    fetchActiveCount(),
    fetchSalesPages(nowMs),
    fetchUnshippedOrders(),
    countPendingOffers(),
    fetchUnansweredQuestions(),
    fetchStaleCount(nowMs),
  ]);
  const bodies = settled(salesBodies);
  const weekly = bodies ? weeklyFromTrend(bodies, nowMs) : null;
  const shipRes = settled(ship);
  const q = settled(questions);
  return {
    active: settled(active),
    weeklyRevenue: weekly ? Math.round(weekly.revenue * 100) / 100 : null,
    weeklySales: weekly ? weekly.sales : null,
    trendSales: bodies ? bodies.flatMap((b) => parseTrendSales(b, nowMs - TREND_DAYS * DAY_MS)) : null,
    shipCount: shipRes && !shipRes.error ? shipRes.items.length : null,
    pendingOffers: settled(offers),
    buyerQuestions: q && !q.error ? q.questions.length : null,
    staleListings: settled(stale),
    generatedAt: new Date(nowMs).toISOString(),
  };
}

// Per-seller cache (per server instance). In-flight builds are shared so a
// double-tap doesn't double the eBay calls. Failed numbers come back as
// null and are simply cached with the rest for the short TTL.
const summaryCache = new Map<string, { value: DashboardSummary; expires: number }>();
const inFlight = new Map<string, Promise<DashboardSummary>>();

/** Cached per seller for SUMMARY_TTL_MS; `fresh` skips the cache and refills it. */
export function getDashboardSummary(
  userId: string,
  fresh = false,
  build: () => Promise<DashboardSummary> = () => buildDashboardSummary(),
  now: () => number = Date.now,
): Promise<DashboardSummary> {
  const hit = summaryCache.get(userId);
  if (!fresh && hit && hit.expires > now()) return Promise.resolve(hit.value);
  const pending = inFlight.get(userId);
  if (pending) return pending;
  const p = build()
    .then((value) => {
      for (const [k, v] of summaryCache) if (v.expires <= now()) summaryCache.delete(k);
      summaryCache.set(userId, { value, expires: now() + SUMMARY_TTL_MS });
      return value;
    })
    .finally(() => inFlight.delete(userId));
  inFlight.set(userId, p);
  return p;
}

/** Drop a seller's cached summary (e.g. after they act on an offer). */
export function invalidateDashboardSummary(userId: string) {
  summaryCache.delete(userId);
}
