import { describe, it, expect } from "vitest";
import { toCents, parseLedgerTx, buildLedger, compareWithSummary, payoutBridge, type LedgerTx, type RawLedgerTx } from "./ledger";

const P = { start: Date.parse("2026-10-19T07:00:00Z"), end: Date.parse("2026-11-18T08:00:00Z") };
let i = 0;
const raw = (o: Partial<RawLedgerTx> & { amt: string; fee?: string; entry?: string }): LedgerTx =>
  parseLedgerTx({
    transactionId: `t${++i}`, transactionType: "SALE", transactionStatus: "PAYOUT", transactionDate: "2026-11-01T12:00:00Z",
    bookingEntry: o.entry ?? "CREDIT", amount: { value: o.amt }, totalFeeAmount: o.fee ? { value: o.fee } : undefined, ...o,
  });

describe("toCents", () => {
  it("parses decimal strings exactly", () => {
    expect(toCents("12.34")).toBe(1234);
    expect(toCents("0.1")).toBe(10);
    expect(toCents("3063.79")).toBe(306379);
    expect(toCents("-0.05")).toBe(-5);
    expect(toCents("1.005")).toBe(101);
    expect(toCents("")).toBe(0);
    expect(toCents("abc")).toBe(0);
  });
  it("avoids float drift that plain addition has", () => {
    const parts = ["0.10", "0.20", "0.30"];
    expect(parts.reduce((a, p) => a + parseFloat(p), 0)).not.toBe(0.6); // floats drift
    expect(parts.reduce((a, p) => a + toCents(p), 0)).toBe(60); // cents don't
  });
});

describe("buildLedger", () => {
  const txs = [
    raw({ amt: "34.56", fee: "5.44", orderId: "A" }), // sale: gross 40.00, fee 5.44
    raw({ amt: "17.00", fee: "3.00", orderId: "B", transactionStatus: "FUNDS_ON_HOLD" }),
    raw({ transactionType: "SHIPPING_LABEL", amt: "8.25", entry: "DEBIT", orderId: "A", transactionStatus: "FUNDS_PROCESSING" }),
    raw({ transactionType: "NON_SALE_CHARGE", feeType: "AD_FEE", amt: "2.10", entry: "DEBIT" }),
    raw({ transactionType: "NON_SALE_CHARGE", feeType: "INSERTION_FEE", amt: "0.35", entry: "DEBIT", transactionStatus: "FUNDS_AVAILABLE_FOR_PAYOUT" }),
    raw({ transactionType: "REFUND", amt: "10.00", entry: "DEBIT", orderId: "B" }),
    raw({ transactionType: "CREDIT", amt: "1.00" }),
    raw({ transactionType: "SOMETHING_NEW", amt: "0.42" }),
    raw({ transactionType: "TRANSFER", amt: "50.00", entry: "DEBIT" }), // money movement, not earnings
    raw({ amt: "99.99", fee: "1", transactionDate: "2026-10-01T00:00:00Z" }), // outside period
  ];
  const L = buildLedger(txs, P);

  it("puts each transaction in one line and the lines add up to eBay's net exactly", () => {
    expect(L.linesSumCents).toBe(L.netCents);
    expect(L.netCents).toBe(3456 + 1700 - 825 - 210 - 35 - 1000 + 100 + 42);
  });
  it("sales are before fees; fees come from eBay's totalFeeAmount", () => {
    expect(L.lines.find((l) => l.key === "sales")!.cents).toBe(4000 + 2000);
    expect(L.lines.find((l) => l.key === "fees")!.cents).toBe(-(544 + 300));
  });
  it("splits ads from other eBay fees and keeps unknown types visible", () => {
    expect(L.lines.find((l) => l.key === "ads")!.cents).toBe(-210);
    expect(L.lines.find((l) => l.key === "other_charges")!.cents).toBe(-35);
    expect(L.lines.find((l) => l.key === "unclassified")!.cents).toBe(42);
  });
  it("excludes payouts/transfers from earnings and periods outside the range", () => {
    expect(L.movementCents).toBe(-5000);
    expect(L.txCount).toBe(8);
  });
  it("fund status buckets add back up to the net", () => {
    const f = L.funds;
    expect(f.paidOut + f.processing + f.onHold + f.available + f.other).toBe(L.netCents);
    expect(f.onHold).toBe(1700);
    expect(f.processing).toBe(-825);
  });
  it("each line lists the transactions behind it", () => {
    expect(L.lines.find((l) => l.key === "labels")!.txIds).toHaveLength(1);
    expect(L.lines.find((l) => l.key === "sales")!.txIds).toHaveLength(2);
  });
});

describe("compareWithSummary", () => {
  const txs = [raw({ amt: "30.00", fee: "4" }), raw({ transactionType: "REFUND", amt: "5.00", entry: "DEBIT" }), raw({ transactionType: "SHIPPING_LABEL", amt: "7.50", entry: "DEBIT" })];
  it("matches when eBay's totals equal ours", () => {
    const c = compareWithSummary(txs, P, { creditCents: 3000, refundCents: 500, shippingLabelCents: 750 });
    expect(c.every((x) => x.diff === 0)).toBe(true);
  });
  it("reports the exact difference per line when they don't", () => {
    const c = compareWithSummary(txs, P, { refundCents: 650 });
    expect(c).toEqual([{ label: "Refunds", ours: 500, ebay: 650, diff: 150 }]);
  });
  it("no summary -> no checks", () => {
    expect(compareWithSummary(txs, P, null)).toEqual([]);
  });
});

describe("payoutBridge", () => {
  it("net - payouts sent = not yet paid - from earlier, exactly", () => {
    const txs = [
      raw({ amt: "20.00", fee: "2", payoutId: "P1" }),
      raw({ amt: "15.00", fee: "2", payoutId: "P9", transactionDate: "2026-11-17T00:00:00Z" }), // paid after period end
      raw({ amt: "5.00", fee: "1", transactionStatus: "FUNDS_ON_HOLD" }),
    ];
    const payouts = [
      { id: "P1", date: "2026-11-03T00:00:00Z", amountCents: 2600, status: "SUCCEEDED" }, // includes $6 from before the period
      { id: "P9", date: "2026-11-25T00:00:00Z", amountCents: 1500, status: "SUCCEEDED" },
    ];
    const b = payoutBridge(txs, payouts, P);
    const net = buildLedger(txs, P).netCents;
    expect(b.payoutsSentCents).toBe(2600);
    expect(b.fromThisPeriodCents).toBe(2000);
    expect(b.fromEarlierCents).toBe(600);
    expect(b.notYetPaidCents).toBe(2000);
    expect(net - b.payoutsSentCents).toBe(b.notYetPaidCents - b.fromEarlierCents);
  });
});
