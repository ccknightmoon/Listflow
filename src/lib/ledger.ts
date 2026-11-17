// The money ledger for the Sales page, built ONLY from eBay Finances
// transactions -- eBay's own record of what hit the seller's account.
// All arithmetic is integer cents. Date basis everywhere: eBay's
// transactionDate.
//
// Every transaction lands in exactly one line, so the lines always add up
// to eBay's net. The reconciliation checks that are NOT true by
// construction are:
//   1. eBay's own transaction_summary totals vs our per-line totals;
//   2. where the net is sitting (paid out / processing / on hold /
//      available) adds back up to the net;
//   3. a payout bridge: net earned this period vs payouts eBay sent.

export type Cents = number;

/** Exact decimal string -> integer cents ("12.3" -> 1230, "-0.05" -> -5). */
export function toCents(v: string | number | null | undefined): Cents {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : 0;
  const m = v.trim().match(/^([+-])?(\d*)(?:\.(\d*))?$/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const whole = parseInt(m[2] || "0", 10);
  const frac = (m[3] ?? "").padEnd(3, "0");
  // round half away from zero on the 3rd decimal
  let cents = whole * 100 + parseInt(frac.slice(0, 2), 10);
  if (parseInt(frac[2], 10) >= 5) cents += 1;
  return sign * cents;
}

export const dollars = (c: Cents) => c / 100;

export interface RawLedgerTx {
  transactionId?: string;
  transactionType?: string;
  transactionStatus?: string;
  transactionDate?: string;
  orderId?: string;
  payoutId?: string;
  feeType?: string;
  transactionMemo?: string;
  bookingEntry?: string;
  amount?: { value?: string };
  totalFeeAmount?: { value?: string };
}

export interface LedgerTx {
  id: string;
  type: string;
  status: string;
  date: string;
  orderId: string | null;
  payoutId: string | null;
  feeType: string | null;
  memo: string | null;
  /** Signed: money in (+) / out (-) of the seller's eBay balance. */
  amountCents: Cents;
  /** SALE only: eBay's total selling fees on the order (positive). */
  feeCents: Cents;
}

export function parseLedgerTx(r: RawLedgerTx, idx = 0): LedgerTx {
  const abs = Math.abs(toCents(r.amount?.value));
  const debit = (r.bookingEntry ?? "").toUpperCase() === "DEBIT";
  return {
    id: r.transactionId || `tx-${idx}`,
    type: (r.transactionType ?? "").toUpperCase(),
    status: (r.transactionStatus ?? "").toUpperCase(),
    date: r.transactionDate ?? "",
    orderId: r.orderId?.trim() || null,
    payoutId: r.payoutId?.trim() || null,
    feeType: r.feeType ?? null,
    memo: r.transactionMemo ?? null,
    amountCents: debit ? -abs : abs,
    feeCents: Math.abs(toCents(r.totalFeeAmount?.value)),
  };
}

// Money moving in/out of the balance that isn't earnings (bank payouts,
// spending the balance on eBay purchases, loan repayments).
export const MOVEMENT_TYPES = new Set(["PAYOUT", "TRANSFER", "WITHDRAWAL", "PURCHASE", "LOAN_REPAYMENT"]);

export type LineKey =
  | "sales" | "fees" | "refunds" | "labels" | "ads" | "other_charges"
  | "disputes" | "credits" | "adjustments" | "unclassified";

export const LINE_LABELS: Record<LineKey, string> = {
  sales: "Sales (before fees)",
  fees: "eBay selling fees",
  refunds: "Refunds to buyers",
  labels: "eBay shipping labels",
  ads: "Promoted listing ads",
  other_charges: "Other eBay fees",
  disputes: "Disputes",
  credits: "Credits from eBay",
  adjustments: "Adjustments",
  unclassified: "Other (unrecognized type)",
};

const LINE_ORDER: LineKey[] = ["sales", "fees", "labels", "ads", "other_charges", "refunds", "disputes", "adjustments", "credits", "unclassified"];

export interface LedgerLine {
  key: LineKey;
  label: string;
  cents: Cents;
  txIds: string[];
}

export function isAdFee(t: LedgerTx): boolean {
  return /^AD_FEE|PROMOTED|AD_/i.test(t.feeType ?? "");
}

export interface PeriodRange { start: number; end: number }

export function inRange(t: LedgerTx, p: PeriodRange): boolean {
  const ms = Date.parse(t.date);
  return !Number.isNaN(ms) && ms >= p.start && ms < p.end;
}

export interface Ledger {
  lines: LedgerLine[]; // only lines with activity, in display order
  /** eBay's net for the period: sum of signed amounts of every earnings transaction. */
  netCents: Cents;
  linesSumCents: Cents;
  salesCents: Cents;
  movementCents: Cents;
  funds: { paidOut: Cents; processing: Cents; onHold: Cents; available: Cents; other: Cents };
  txCount: number;
}

export function buildLedger(all: LedgerTx[], p: PeriodRange): Ledger {
  const acc = new Map<LineKey, LedgerLine>();
  const add = (key: LineKey, cents: Cents, id: string) => {
    let line = acc.get(key);
    if (!line) acc.set(key, (line = { key, label: LINE_LABELS[key], cents: 0, txIds: [] }));
    line.cents += cents;
    if (!line.txIds.includes(id)) line.txIds.push(id);
  };
  let net = 0, movement = 0, count = 0;
  const funds = { paidOut: 0, processing: 0, onHold: 0, available: 0, other: 0 };
  for (const t of all) {
    if (!inRange(t, p)) continue;
    if (MOVEMENT_TYPES.has(t.type)) {
      movement += t.amountCents;
      continue;
    }
    count++;
    net += t.amountCents;
    switch (t.type) {
      case "SALE":
        add("sales", t.amountCents + t.feeCents, t.id);
        if (t.feeCents) add("fees", -t.feeCents, t.id);
        break;
      case "REFUND": add("refunds", t.amountCents, t.id); break;
      case "SHIPPING_LABEL": add("labels", t.amountCents, t.id); break;
      case "NON_SALE_CHARGE": add(isAdFee(t) ? "ads" : "other_charges", t.amountCents, t.id); break;
      case "DISPUTE": add("disputes", t.amountCents, t.id); break;
      case "CREDIT": add("credits", t.amountCents, t.id); break;
      case "ADJUSTMENT": add("adjustments", t.amountCents, t.id); break;
      default: add("unclassified", t.amountCents, t.id);
    }
    if (t.status === "PAYOUT" || t.status === "COMPLETED" || t.payoutId) funds.paidOut += t.amountCents;
    else if (t.status === "FUNDS_PROCESSING") funds.processing += t.amountCents;
    else if (t.status === "FUNDS_ON_HOLD") funds.onHold += t.amountCents;
    else if (t.status === "FUNDS_AVAILABLE_FOR_PAYOUT") funds.available += t.amountCents;
    else funds.other += t.amountCents;
  }
  const lines = LINE_ORDER.map((k) => acc.get(k)).filter((l): l is LedgerLine => Boolean(l));
  return {
    lines,
    netCents: net,
    linesSumCents: lines.reduce((a, l) => a + l.cents, 0),
    salesCents: acc.get("sales")?.cents ?? 0,
    movementCents: movement,
    funds,
    txCount: count,
  };
}

// --------------------------------------------------- eBay summary check

/** Subset of eBay's transaction_summary we can compare (all as given by eBay). */
export interface EbaySummary {
  creditCents?: Cents; // SALE + CREDIT credits
  refundCents?: Cents;
  shippingLabelCents?: Cents;
  nonSaleChargeCents?: Cents;
  disputeCents?: Cents;
  onHoldCents?: Cents;
}

export interface Check {
  label: string;
  ours: Cents;
  ebay: Cents;
  diff: Cents; // ebay - ours
}

/** Compare our per-line totals with eBay's own summary (absolute values, eBay reports magnitudes). */
export function compareWithSummary(all: LedgerTx[], p: PeriodRange, s: EbaySummary | null): Check[] {
  if (!s) return [];
  const sum = (pred: (t: LedgerTx) => boolean) =>
    Math.abs(all.filter((t) => inRange(t, p) && pred(t)).reduce((a, t) => a + t.amountCents, 0));
  const checks: Check[] = [];
  const push = (label: string, ours: Cents, ebay: Cents | undefined) => {
    if (ebay == null) return;
    checks.push({ label, ours, ebay: Math.abs(ebay), diff: Math.abs(ebay) - ours });
  };
  push("Sales & credits", sum((t) => (t.type === "SALE" || t.type === "CREDIT") && t.amountCents > 0), s.creditCents);
  push("Refunds", sum((t) => t.type === "REFUND"), s.refundCents);
  push("Shipping labels", sum((t) => t.type === "SHIPPING_LABEL"), s.shippingLabelCents);
  push("Other charges & ads", sum((t) => t.type === "NON_SALE_CHARGE"), s.nonSaleChargeCents);
  push("Disputes", sum((t) => t.type === "DISPUTE"), s.disputeCents);
  return checks;
}

// --------------------------------------------------------- payout bridge

export interface Payout {
  id: string;
  date: string;
  amountCents: Cents;
  status: string;
}

export interface PayoutBridge {
  payoutsSentCents: Cents; // payouts dated in the period
  fromThisPeriodCents: Cents; // of the period's net, the part paid in those payouts
  fromEarlierCents: Cents; // part of those payouts that came from before the period
  notYetPaidCents: Cents; // of the period's net, not paid out by period end
}

/**
 * net(period) - payoutsSent(period) = notYetPaid - fromEarlier, exactly.
 * fromEarlier is the residual (transactions before our data window are
 * unknown), so the identity always holds; every other number is eBay's.
 */
export function payoutBridge(all: LedgerTx[], payouts: Payout[], p: PeriodRange): PayoutBridge {
  const inP = (d: string) => { const ms = Date.parse(d); return !Number.isNaN(ms) && ms >= p.start && ms < p.end; };
  const sent = payouts.filter((x) => inP(x.date));
  const sentIds = new Set(sent.map((x) => x.id));
  const payoutsSentCents = sent.reduce((a, x) => a + x.amountCents, 0);
  let fromThis = 0, notYet = 0;
  for (const t of all) {
    if (!inRange(t, p) || MOVEMENT_TYPES.has(t.type)) continue;
    if (t.payoutId && sentIds.has(t.payoutId)) fromThis += t.amountCents;
    else notYet += t.amountCents;
  }
  return { payoutsSentCents, fromThisPeriodCents: fromThis, fromEarlierCents: payoutsSentCents - fromThis, notYetPaidCents: notYet };
}
