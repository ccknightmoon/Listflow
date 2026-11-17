import https from "node:https";
import { getAccessToken } from "./ebay-oauth";
import type { FinanceTx } from "./finance-match";
import { parseLedgerTx, toCents, type EbaySummary, type LedgerTx, type Payout, type RawLedgerTx } from "./ledger";

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



const FINANCE_WINDOW_DAYS = 90;

/**
 * Every Finances transaction in the range, parsed exactly (integer cents)
 * for the Sales ledger. Also returns the simplified FinanceTx view used to
 * attach real fees to sale lines.
 */
export async function fetchFinanceTransactions(startMs: number, endMs: number): Promise<{ tx: FinanceTx[]; ledger: LedgerTx[]; truncated: boolean } | null> {
  try {
    const windows: Array<[number, number]> = [];
    for (let to = endMs; to > startMs; to -= FINANCE_WINDOW_DAYS * 86_400_000) {
      windows.push([Math.max(startMs, to - FINANCE_WINDOW_DAYS * 86_400_000), to]);
    }
    const results = await Promise.all(windows.map(async ([from, to]) => {
      const out: RawLedgerTx[] = [];
      let offset = 0;
      let total = Infinity;
      let page = 0;
      while (offset < total && page < FINANCES_MAX_PAGES) {
        const filter = encodeURIComponent(`transactionDate:[${new Date(from).toISOString()}..${new Date(to).toISOString()}]`);
        const { status, data } = await financesRequest(`/sell/finances/v1/transaction?filter=${filter}&limit=${FINANCES_PAGE_SIZE}&offset=${offset}`);
        if (status >= 400) return null;
        const body = data as { transactions?: RawLedgerTx[]; total?: number };
        const list = body.transactions ?? [];
        out.push(...list);
        total = typeof body.total === "number" ? body.total : list.length;
        if (list.length === 0) break;
        offset += list.length;
        page++;
      }
      return { raw: out, truncated: offset < total };
    }));
    if (results.some((r) => r === null)) return null;
    const ok = results as Array<{ raw: RawLedgerTx[]; truncated: boolean }>;
    // Windows share an edge instant; de-duplicate by transaction id.
    const seen = new Set<string>();
    const ledger: LedgerTx[] = [];
    ok.flatMap((r) => r.raw).forEach((r, idx) => {
      const t = parseLedgerTx(r, idx);
      if (seen.has(t.id)) return;
      seen.add(t.id);
      ledger.push(t);
    });
    const tx: FinanceTx[] = ledger.map((t) => ({
      type: t.type,
      orderId: t.orderId,
      date: t.date,
      fee: t.feeCents / 100,
      amount: Math.abs(t.amountCents) / 100,
      bookingEntry: t.amountCents < 0 ? "DEBIT" : "CREDIT",
    }));
    return { tx, ledger, truncated: ok.some((r) => r.truncated) };
  } catch {
    return null;
  }
}

/** Payouts eBay sent to the bank in the range (read-only). */
export async function fetchPayouts(startMs: number, endMs: number): Promise<Payout[] | null> {
  try {
    const filter = encodeURIComponent(`payoutDate:[${new Date(startMs).toISOString()}..${new Date(endMs).toISOString()}]`);
    const out: Payout[] = [];
    let offset = 0;
    for (let page = 0; page < 10; page++) {
      const { status, data } = await financesRequest(`/sell/finances/v1/payout?filter=${filter}&limit=200&offset=${offset}`);
      if (status >= 400) return null;
      const body = data as { payouts?: Array<{ payoutId?: string; payoutDate?: string; payoutStatus?: string; amount?: { value?: string } }>; total?: number };
      const list = body.payouts ?? [];
      for (const p of list) {
        out.push({ id: p.payoutId ?? "", date: p.payoutDate ?? "", amountCents: toCents(p.amount?.value), status: p.payoutStatus ?? "" });
      }
      offset += list.length;
      if (list.length === 0 || offset >= (body.total ?? offset)) break;
    }
    return out;
  } catch {
    return null;
  }
}

/** eBay's own totals for a date range, used to cross-check the ledger. */
export async function fetchTransactionSummary(fromIso: string, toIso: string): Promise<EbaySummary | null> {
  try {
    const filter = encodeURIComponent(`transactionDate:[${fromIso}..${toIso}]`);
    const { status, data } = await financesRequest(`/sell/finances/v1/transaction_summary?filter=${filter}`);
    if (status >= 400) return null;
    const d = data as Record<string, { value?: string } | undefined>;
    const c = (k: string) => (d[k]?.value != null ? Math.abs(toCents(d[k]?.value)) : undefined);
    return {
      creditCents: c("creditAmount"),
      refundCents: c("refundAmount"),
      shippingLabelCents: c("shippingLabelAmount"),
      nonSaleChargeCents: c("nonSaleChargeAmount"),
      disputeCents: c("disputeAmount"),
      onHoldCents: c("onHoldAmount"),
    };
  } catch {
    return null;
  }
}
