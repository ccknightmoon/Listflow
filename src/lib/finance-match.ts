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

export interface FinanceExtrasOut {
  refunds: Array<{ date: string; amount: number }>;
  labels: Array<{ date: string; amount: number }>;
  otherCharges: Array<{ date: string; amount: number }>;
}

/** Money that leaves the seller outside of sale fees: refunds, eBay labels, other charges (ads etc.). */
export function extractFinanceExtras(tx: FinanceTx[]): FinanceExtrasOut {
  const out: FinanceExtrasOut = { refunds: [], labels: [], otherCharges: [] };
  for (const t of tx) {
    if (!Number.isFinite(t.amount) || t.amount === 0) continue;
    // Credits (e.g. a label refund, a fee credit) reduce the cost.
    const signed = t.bookingEntry === "CREDIT" ? -Math.abs(t.amount) : Math.abs(t.amount);
    if (t.type === "REFUND") out.refunds.push({ date: t.date, amount: Math.abs(t.amount) });
    else if (t.type === "SHIPPING_LABEL") out.labels.push({ date: t.date, amount: signed });
    else if (t.type === "NON_SALE_CHARGE") out.otherCharges.push({ date: t.date, amount: signed });
  }
  return out;
}
