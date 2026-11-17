import https from "node:https";
import { getAccessToken } from "./ebay-oauth";
import type { FinanceTx } from "./finance-match";

// eBay's Sell Finances API -- unlike every other REST call in this app
// (ebay-inventory.ts's inventoryRequest, which hits api.ebay.com), this API
// is served from a DIFFERENT host, apiz.ebay.com. Confirmed against eBay's
// own published OpenAPI spec for this API before writing this, since
// getting a hostname wrong here would just silently 404/DNS-fail rather
// than doing anything visibly broken -- worth getting right the first time
// regardless.
//
// Requires the sell.finances OAuth scope (added to EBAY_SCOPES in
// ebay-oauth.ts alongside this). Anyone connected before that scope was
// added needs to reconnect once to pick it up -- same "reconnect required"
// story as every previous scope addition in this app (see the Phase 2 note
// in CLAUDE.md). Until they do, eBay returns 403 for this call, which
// fetchRealFeesForRange treats as "not available yet," not an error --
// real numbers are a bonus on top of the existing fee estimate, never a
// hard requirement.
function financesRequest(path: string): Promise<{ status: number; data: Record<string, unknown> }> {
  return getAccessToken().then(
    (token) =>
      new Promise((resolve, reject) => {
        const req = https.request(
          {
            hostname: "apiz.ebay.com",
            path,
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          },
          (res) => {
            let raw = "";
            res.on("data", (c: Buffer) => { raw += c.toString(); });
            res.on("end", () => {
              try {
                const data = raw ? JSON.parse(raw) : {};
                resolve({ status: res.statusCode ?? 200, data });
              } catch {
                reject(new Error(`eBay Finances API returned a non-JSON response (HTTP ${res.statusCode ?? "?"}): ${raw.slice(0, 300)}`));
              }
            });
          }
        );
        req.on("error", reject);
        req.end();
      })
  );
}

interface FinancesTransaction {
  transactionType?: string;
  totalFeeAmount?: { value?: string };
}
interface FinancesTransactionsPage {
  transactions?: FinancesTransaction[];
  total?: number;
}

export interface RealFeesResult {
  totalRealFees: number;
  saleTransactionCount: number;
  // True if the safety page cap below was hit before every transaction in
  // range was read -- same "say so rather than silently truncate" pattern
  // as GALLERY_LOOKUP_MAX/OFFERS_LOOKUP_MAX elsewhere in this app.
  truncated: boolean;
}

const FINANCES_PAGE_SIZE = 1000;
// Safety backstop against a runaway loop, mirroring MAX_PAGES in
// ebay-listings.ts -- 20 * 1000 = 20,000 transactions, far beyond what a
// single seller's window (max 365 days, per the days param cap in
// sales/route.ts) should ever produce.
const FINANCES_MAX_PAGES = 20;

// Sums real, eBay-reported selling fees (totalFeeAmount) across every SALE
// transaction in the given date range -- an aggregate, not a per-item
// breakdown. Deliberately NOT merged into the existing per-sale estimate in
// sales/route.ts: GetSellerTransactions (Trading API, what builds the sale
// list itself) and this Finances API call use different underlying data
// sources with no guaranteed one-to-one row correspondence (order grouping,
// timing/timezone edges), so claiming an exact per-row swap would risk
// silently misattributing a real number to the wrong line. Surfaced as a
// separate, clearly-labeled "actual fees this period" figure instead.
//
// Returns null (not a throw) for anything that means "not available right
// now" -- scope not granted yet (403), eBay outage, or any other failure --
// so a caller can fall back to the estimate without extra try/catch of its
// own. Only a truly unexpected condition should reach the caller as a
// throw, and this function has none of those.
export async function fetchRealFeesForRange(startISO: string, endISO: string): Promise<RealFeesResult | null> {
  try {
    let offset = 0;
    let total = Infinity;
    let page = 0;
    let totalRealFees = 0;
    let saleTransactionCount = 0;

    while (offset < total && page < FINANCES_MAX_PAGES) {
      const filter = encodeURIComponent(`transactionDate:[${startISO}..${endISO}]`);
      const { status, data } = await financesRequest(
        `/sell/finances/v1/transaction?filter=${filter}&limit=${FINANCES_PAGE_SIZE}&offset=${offset}`
      );

      if (status === 403) return null; // scope not granted -- needs a reconnect
      if (status >= 400) return null; // any other failure -- estimate stands in instead

      const body = data as FinancesTransactionsPage;
      const transactions = body.transactions ?? [];
      for (const t of transactions) {
        if (t.transactionType === "SALE" && t.totalFeeAmount?.value) {
          const fee = parseFloat(t.totalFeeAmount.value);
          if (!isNaN(fee)) {
            totalRealFees += fee;
            saleTransactionCount++;
          }
        }
      }

      total = typeof body.total === "number" ? body.total : transactions.length;
      if (transactions.length === 0) break;
      offset += transactions.length;
      page++;
    }

    return { totalRealFees, saleTransactionCount, truncated: offset < total };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-transaction feed for the Sales analytics page (real per-order fees,
// refunds, eBay shipping labels, other charges). Same "null = not
// available" contract as fetchRealFeesForRange above.


interface RawFinanceTx {
  transactionType?: string;
  transactionDate?: string;
  orderId?: string;
  bookingEntry?: string;
  amount?: { value?: string };
  totalFeeAmount?: { value?: string };
}

const FINANCE_WINDOW_DAYS = 90;

export async function fetchFinanceTransactions(startMs: number, endMs: number): Promise<{ tx: FinanceTx[]; truncated: boolean } | null> {
  try {
    const windows: Array<[number, number]> = [];
    for (let to = endMs; to > startMs; to -= FINANCE_WINDOW_DAYS * 86_400_000) {
      windows.push([Math.max(startMs, to - FINANCE_WINDOW_DAYS * 86_400_000), to]);
    }
    const results = await Promise.all(windows.map(async ([from, to]) => {
      const out: FinanceTx[] = [];
      let offset = 0;
      let total = Infinity;
      let page = 0;
      while (offset < total && page < FINANCES_MAX_PAGES) {
        const filter = encodeURIComponent(`transactionDate:[${new Date(from).toISOString()}..${new Date(to).toISOString()}]`);
        const { status, data } = await financesRequest(`/sell/finances/v1/transaction?filter=${filter}&limit=${FINANCES_PAGE_SIZE}&offset=${offset}`);
        if (status >= 400) return null;
        const body = data as { transactions?: RawFinanceTx[]; total?: number };
        const list = body.transactions ?? [];
        for (const t of list) {
          out.push({
            type: t.transactionType ?? "",
            orderId: t.orderId ?? null,
            date: t.transactionDate ?? "",
            fee: parseFloat(t.totalFeeAmount?.value ?? "0") || 0,
            amount: parseFloat(t.amount?.value ?? "0") || 0,
            bookingEntry: t.bookingEntry ?? null,
          });
        }
        total = typeof body.total === "number" ? body.total : list.length;
        if (list.length === 0) break;
        offset += list.length;
        page++;
      }
      return { tx: out, truncated: offset < total };
    }));
    if (results.some((r) => r === null)) return null;
    const ok = results as Array<{ tx: FinanceTx[]; truncated: boolean }>;
    return { tx: ok.flatMap((r) => r.tx), truncated: ok.some((r) => r.truncated) };
  } catch {
    return null;
  }
}
