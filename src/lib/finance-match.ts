// Matches eBay Finances API transactions to the sale lines from
// GetSellerTransactions, so each sale can show the fee eBay ACTUALLY
// charged instead of an estimate. Pure, unit-tested.
//
// Matching is by order ID. A Finances SALE transaction is per order; when
// an order has several sale lines, its fee is split across them in
// proportion to each line's fee base (item + shipping + tax). Anything
// that can't be matched keeps actualFee = null and the page falls back to
// the clearly-labelled estimate.

export interface FinanceTx {
  type: string; // SALE | REFUND | SHIPPING_LABEL | NON_SALE_CHARGE | ...
  orderId: string | null;
  date: string;
  /** totalFeeAmount for SALE transactions */
  fee: number;
  /** amount.value (absolute) */
  amount: number;
  /** "CREDIT" | "DEBIT" */
  bookingEntry: string | null;
}

export interface MatchableSale {
  key: string;
  orderId: string | null;
  itemTotal: number;
  shippingPaid: number;
  taxPaid: number;
}

export function normalizeOrderId(id: string | null | undefined): string | null {
  const t = (id ?? "").trim();
  return t ? t.toUpperCase() : null;
}

export function allocateActualFees(sales: MatchableSale[], tx: FinanceTx[]): Map<string, number> {
  const feeByOrder = new Map<string, number>();
  for (const t of tx) {
    if (t.type !== "SALE") continue;
    const id = normalizeOrderId(t.orderId);
    if (!id || !Number.isFinite(t.fee)) continue;
    feeByOrder.set(id, (feeByOrder.get(id) ?? 0) + t.fee);
  }
  const linesByOrder = new Map<string, MatchableSale[]>();
  for (const s of sales) {
    const id = normalizeOrderId(s.orderId);
    if (!id || !feeByOrder.has(id)) continue;
    const list = linesByOrder.get(id);
    if (list) list.push(s);
    else linesByOrder.set(id, [s]);
  }
  const out = new Map<string, number>();
  for (const [id, lines] of linesByOrder) {
    const fee = feeByOrder.get(id) ?? 0;
    const bases = lines.map((l) => Math.max(0, l.itemTotal + (l.shippingPaid || 0) + (l.taxPaid || 0)));
    const totalBase = bases.reduce((a, b) => a + b, 0);
    let allocated = 0;
    lines.forEach((l, i) => {
      const share = i === lines.length - 1
        ? Math.round((fee - allocated) * 100) / 100 // last line takes the rounding remainder
        : Math.round((totalBase > 0 ? (fee * bases[i]) / totalBase : fee / lines.length) * 100) / 100;
      allocated += share;
      out.set(l.key, share);
    });
  }
  return out;
}

export interface DatedCharge {
  date: string;
  amount: number;
  /** Set when this charge belongs to a known sale -- then `date` is that sale's date. */
  orderId?: string | null;
}

export interface FinanceExtrasOut {
  refunds: DatedCharge[];
  labels: DatedCharge[];
  otherCharges: DatedCharge[];
}

export interface AttributionContext {
  /** normalized order id -> sale date, for sales counted on the page */
  saleDateByOrder: Map<string, string>;
  /** normalized order ids of cancelled orders (already excluded from sales) */
  cancelledOrders: Set<string>;
}

/**
 * Money that leaves the seller outside of sale fees: refunds, eBay labels,
 * other charges (ads etc.).
 *
 * Dating rule: a charge tied to an order we know is dated by that SALE's
 * date, so a label bought Oct 19 for an Oct 17 sale lands in the same
 * period as the sale. Charges with no matching sale keep eBay's
 * transaction date.
 *
 * Refunds for CANCELLED orders are skipped: those sales were never counted
 * in item sales, so subtracting the refund too would count it twice.
 */
export function extractFinanceExtras(tx: FinanceTx[], ctx?: AttributionContext): FinanceExtrasOut {
  const out: FinanceExtrasOut = { refunds: [], labels: [], otherCharges: [] };
  for (const t of tx) {
    if (!Number.isFinite(t.amount) || t.amount === 0) continue;
    const order = normalizeOrderId(t.orderId);
    if (t.type === "REFUND" && order && ctx?.cancelledOrders.has(order)) continue;
    const saleDate = order ? ctx?.saleDateByOrder.get(order) : undefined;
    const date = saleDate ?? t.date;
    const orderId = saleDate ? order : null;
    // Credits (e.g. a label refund, a fee credit) reduce the cost.
    const signed = t.bookingEntry === "CREDIT" ? -Math.abs(t.amount) : Math.abs(t.amount);
    if (t.type === "REFUND") out.refunds.push({ date, amount: Math.abs(t.amount), orderId });
    else if (t.type === "SHIPPING_LABEL") out.labels.push({ date, amount: signed, orderId });
    else if (t.type === "NON_SALE_CHARGE") out.otherCharges.push({ date, amount: signed, orderId });
  }
  return out;
}
