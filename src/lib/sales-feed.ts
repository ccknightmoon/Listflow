// Server-side data feed for the Sales analytics page: ~6 months of eBay
// sales fetched ONCE (paginated, de-duplicated, cancelled/unpaid removed),
// joined with Listflow drafts and saved costs, plus eBay Finances data
// (real fees, refunds, labels) and current active listings. The page
// derives every 7/30/90-day view from this one payload.

import { verifiedUser } from "@/lib/verified-user";
import { tradingRequest } from "./ebay-inventory";
import { fetchFinanceTransactions, fetchPayouts } from "./ebay-finances";
import type { LedgerTx, Payout } from "./ledger";
import { fetchAllOfListType, isListTypeError, toListing } from "./ebay-listings";
import { parseTransactions, xmlFind, decodeXml, type ParsedSale } from "./sales-parse";
import { allocateActualFees, extractFinanceExtras, normalizeOrderId } from "./finance-match";
import type { AnalyticsSale, ActiveListing, DatedAmount } from "./sales-analytics";
import type { getServerSupabase } from "./auth";

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>;

/**
 * eBay's GetSellerTransactions can't return sales older than 90 days, so
 * the feed is the last 90 days (minus a few minutes of safety). That
 * covers the 7d and 30d views AND their previous periods; the 90d view has
 * no previous period to compare against (the page says so).
 */
export const FEED_DAYS = 90;
const FEED_SAFETY_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const MAX_PAGES_PER_WINDOW = 10;
// Newer schema so OrderID/ExtendedOrderID match eBay Finances' orderId.
const TRANSACTIONS_COMPAT_LEVEL = "1225";

function transactionsXml(from: string, to: string, page: number) {
  return `<?xml version="1.0" encoding="utf-8"?><GetSellerTransactionsRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DetailLevel>ReturnAll</DetailLevel><IncludeContainingOrder>true</IncludeContainingOrder><ModTimeFrom>${from}</ModTimeFrom><ModTimeTo>${to}</ModTimeTo><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></GetSellerTransactionsRequest>`;
}

export interface FeedError {
  error: string;
  reconnect: boolean;
}

function ebayError(body: string): FeedError {
  const raw = xmlFind(body, "LongMessage") || xmlFind(body, "ShortMessage") || "eBay API error";
  const msg = decodeXml(decodeXml(raw)).toLowerCase();
  const isAuth = ["auth", "token", "permission", "scope"].some((w) => msg.includes(w));
  return {
    error: isAuth
      ? "Your eBay connection needs to be refreshed. Go to Settings and tap Reconnect, then try again."
      : "Couldn't load sales from eBay right now. Try refreshing in a moment.",
    reconnect: isAuth,
  };
}

const ok = (body: string) => body.includes("<Ack>Success</Ack>") || body.includes("<Ack>Warning</Ack>");

/** All transaction blocks modified in the last `days` days (30-day windows x pages). */
/** Splits [startMs, now] into eBay's max 30-day ModTime windows, newest first. */
export function transactionWindows(now: number, startMs: number): Array<{ from: string; to: string }> {
  const windows: Array<{ from: string; to: string }> = [];
  for (let end = now; end > startMs; ) {
    const start = Math.max(startMs, end - 30 * DAY_MS);
    windows.push({ from: new Date(start).toISOString(), to: new Date(end).toISOString() });
    end = start;
  }
  return windows;
}

async function fetchTransactionBlocks(now: number, startMs: number): Promise<{ blocks: string[]; truncated: boolean } | FeedError> {
  const windows = transactionWindows(now, startMs);
  let truncated = false;
  const perWindow = await Promise.all(windows.map(async (w) => {
    const first = await tradingRequest("GetSellerTransactions", transactionsXml(w.from, w.to, 1), TRANSACTIONS_COMPAT_LEVEL);
    if (!ok(first.body)) return ebayError(first.body);
    const totalPages = parseInt(xmlFind(xmlFind(first.body, "PaginationResult"), "TotalNumberOfPages") || "1", 10) || 1;
    const pages = Math.min(totalPages, MAX_PAGES_PER_WINDOW);
    if (totalPages > pages) truncated = true;
    const bodies = [first.body];
    if (pages > 1) {
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) =>
          tradingRequest("GetSellerTransactions", transactionsXml(w.from, w.to, i + 2), TRANSACTIONS_COMPAT_LEVEL)),
      );
      for (const r of rest) {
        if (ok(r.body)) bodies.push(r.body);
        else truncated = true;
      }
    }
    const blocks: string[] = [];
    for (const b of bodies) {
      const re = /<Transaction>([\s\S]*?)<\/Transaction>/g;
      let m;
      while ((m = re.exec(b)) !== null) blocks.push(m[1]);
    }
    return blocks;
  }));
  const err = perWindow.find((r): r is FeedError => !Array.isArray(r));
  if (err) return err;
  return { blocks: (perWindow as string[][]).flat(), truncated };
}

interface DraftRow {
  ebay_listing_id: string;
  thumbnail_url: string | null;
  cost_basis: number | null;
  item_type: string | null;
  store_category_name: string | null;
  created_at: string | null;
  ebay_listed_at?: string | null;
}

async function loadDrafts(supabase: Supabase, listingIds: string[]): Promise<Map<string, DraftRow>> {
  const map = new Map<string, DraftRow>();
  for (let i = 0; i < listingIds.length; i += 150) {
    const ids = listingIds.slice(i, i + 150);
    const withListed = await supabase
      .from("drafts")
      .select("ebay_listing_id, thumbnail_url, cost_basis, item_type, store_category_name, created_at, ebay_listed_at")
      .in("ebay_listing_id", ids);
    // ebay_listed_at needs migration 026 -- fall back without it.
    const rows: unknown[] | null = withListed.error
      ? (await supabase
          .from("drafts")
          .select("ebay_listing_id, thumbnail_url, cost_basis, item_type, store_category_name, created_at")
          .in("ebay_listing_id", ids)).data
      : withListed.data;
    for (const d of (rows ?? []) as DraftRow[]) map.set(d.ebay_listing_id, d);
  }
  return map;
}

/** Costs saved for sales without a draft (needs migration 040, which replaces 025; empty if not applied). */
async function loadSaleCosts(supabase: Supabase): Promise<{ costs: Map<string, number>; available: boolean }> {
  const { data, error } = await supabase.from("sale_costs").select("sale_key, cost");
  if (error) return { costs: new Map(), available: false };
  return { costs: new Map((data ?? []).map((r) => [r.sale_key as string, Number(r.cost)])), available: true };
}

export interface ListingSnapshot {
  date: string; // YYYY-MM-DD (UTC)
  activeCount: number;
  capturedAt: string;
}

async function loadAndRecordSnapshots(supabase: Supabase, activeCount: number | null, now: number): Promise<ListingSnapshot[] | null> {
  if (activeCount != null) {
    // Best-effort; fails quietly until migration 026 is applied.
    const user = await verifiedUser(supabase as never);
    if (user) {
      await supabase.from("active_listing_snapshots").upsert({
        user_id: user.id,
        snapshot_date: new Date(now).toISOString().slice(0, 10),
        active_count: activeCount,
        captured_at: new Date(now).toISOString(),
      });
    }
  }
  const { data, error } = await supabase
    .from("active_listing_snapshots")
    .select("snapshot_date, active_count, captured_at")
    .gte("snapshot_date", new Date(now - 200 * DAY_MS).toISOString().slice(0, 10))
    .order("snapshot_date");
  if (error) return null;
  return (data ?? []).map((r) => ({ date: r.snapshot_date as string, activeCount: Number(r.active_count), capturedAt: r.captured_at as string }));
}

export interface SalesFeed {
  generatedAt: string;
  feedDays: number;
  /** Earliest moment the feed covers; periods starting earlier can't be compared. */
  feedStart: string;
  sales: Array<AnalyticsSale & { thumbnail: string | null; hasDraft: boolean }>;
  excluded: { cancelled: number; awaitingPayment: number };
  truncated: boolean;
  finances: { available: boolean; truncated: boolean; refunds: DatedAmount[]; labels: DatedAmount[]; otherCharges: DatedAmount[] };
  /** Every eBay Finances transaction in the feed window (integer cents) -- the money source of truth. */
  ledger: LedgerTx[];
  /** Bank payouts eBay sent in the feed window; null if unavailable. */
  payouts: Payout[] | null;
  active: ActiveListing[];
  activeCount: number | null;
  feePercent: number;
  saleCostsAvailable: boolean;
  /** Daily active-listing counts (migration 026); null until it's applied. */
  snapshots: ListingSnapshot[] | null;
}

export async function buildSalesFeed(supabase: Supabase, feePercent: number, now = Date.now()): Promise<SalesFeed | FeedError> {
  const startMs = now - FEED_DAYS * DAY_MS + FEED_SAFETY_MS;
  const [txResult, finances, activeResult, saleCosts, payouts] = await Promise.all([
    fetchTransactionBlocks(now, startMs),
    fetchFinanceTransactions(startMs, now),
    fetchAllOfListType("ActiveList").catch(() => null),
    loadSaleCosts(supabase),
    fetchPayouts(startMs - 14 * DAY_MS, now + DAY_MS),
  ]);
  if ("error" in txResult) return txResult;

  const parsed = parseTransactions(txResult.blocks).filter((s) => Date.parse(s.soldAt) >= startMs);
  const kept: ParsedSale[] = [];
  const excluded = { cancelled: 0, awaitingPayment: 0 };
  for (const s of parsed) {
    if (s.status === "cancelled") excluded.cancelled++;
    else if (s.status === "awaiting_payment") excluded.awaitingPayment++;
    else kept.push(s);
  }

  const drafts = await loadDrafts(supabase, [...new Set(kept.map((s) => s.listingId))]);
  const actualFees = finances ? allocateActualFees(kept, finances.tx) : new Map<string, number>();
  // One date basis for money AND items: eBay's transactionDate of the
  // order's SALE transaction. Sales eBay Finances doesn't (yet) list keep
  // their order date and are flagged on the page.
  const bookedByOrder = new Map<string, string>();
  for (const t of finances?.ledger ?? []) {
    if (t.type !== "SALE" || !t.orderId) continue;
    const id = normalizeOrderId(t.orderId) as string;
    const prev = bookedByOrder.get(id);
    if (!prev || Date.parse(t.date) < Date.parse(prev)) bookedByOrder.set(id, t.date);
  }

  const sales = kept.map((s) => {
    const d = drafts.get(s.listingId);
    const saved = saleCosts.costs.get(s.key);
    const draftCost = typeof d?.cost_basis === "number" ? Number(d.cost_basis) : null;
    return {
      key: s.key,
      listingId: s.listingId,
      title: s.title,
      qty: s.qty,
      itemTotal: s.itemTotal,
      shippingPaid: s.shippingPaid,
      taxPaid: s.taxPaid,
      soldAt: s.soldAt,
      bookedAt: (s.orderId && bookedByOrder.get(normalizeOrderId(s.orderId) as string)) || null,
      orderId: s.orderId,
      // Hard listing start only: eBay's own StartTime, else the moment
      // Listflow published it. Draft creation dates are NOT used (they can
      // be days before the item went live).
      listedAt: s.listedAt ?? d?.ebay_listed_at ?? null,
      listedAtSource: (s.listedAt ? "ebay" : d?.ebay_listed_at ? "listflow" : null) as "ebay" | "listflow" | null,
      ebayCategory: s.ebayCategory,
      storeCategoryName: d?.store_category_name ?? null,
      itemType: d?.item_type ?? null,
      costBasis: saved ?? draftCost,
      actualFee: actualFees.has(s.key) ? (actualFees.get(s.key) as number) : null,
      thumbnail: d?.thumbnail_url ?? null,
      hasDraft: Boolean(d),
    };
  });

  const cancelledOrders = new Set(
    parsed.filter((s) => s.status === "cancelled").map((s) => normalizeOrderId(s.orderId)).filter((x): x is string => Boolean(x)),
  );
  const extras = finances
    ? extractFinanceExtras(finances.tx, { saleDateByOrder: new Map(), cancelledOrders })
    : { refunds: [], labels: [], otherCharges: [] };
  let active: ActiveListing[] = [];
  let activeCount: number | null = null;
  if (activeResult && !isListTypeError(activeResult)) {
    active = activeResult.items.map((x) => toListing(x, "active")).map((l) => ({
      listingId: l.listingId, title: l.title, startTime: l.startTime, price: l.price,
    }));
    activeCount = activeResult.total;
  }

  const snapshots = await loadAndRecordSnapshots(supabase, activeCount, now);

  return {
    snapshots,
    generatedAt: new Date(now).toISOString(),
    feedDays: FEED_DAYS,
    feedStart: new Date(startMs).toISOString(),
    sales,
    excluded,
    truncated: txResult.truncated,
    finances: { available: Boolean(finances), truncated: finances?.truncated ?? false, ...extras },
    ledger: finances?.ledger ?? [],
    payouts,
    active,
    activeCount,
    feePercent,
    saleCostsAvailable: saleCosts.available,
  };
}
