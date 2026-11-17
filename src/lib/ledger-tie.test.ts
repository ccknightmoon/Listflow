import { describe, it, expect } from "vitest";
import { parseLedgerTx, buildLedger, salesBreakdown, pairDisputes, displayLines, type LedgerTx, type RawLedgerTx } from "./ledger";

const P = { start: Date.parse("2026-10-19T07:00:00Z"), end: Date.parse("2026-11-18T09:00:00Z") };
let i = 0;
const tx = (o: Partial<RawLedgerTx> & { amt: string; fee?: string; debit?: boolean }): LedgerTx =>
  parseLedgerTx({ transactionId: `t${++i}`, transactionType: "SALE", transactionStatus: "PAYOUT", transactionDate: "2026-11-02T10:00:00Z",
    bookingEntry: o.debit ? "DEBIT" : "CREDIT", amount: { value: o.amt }, totalFeeAmount: o.fee ? { value: o.fee } : undefined, ...o });

describe("sales line breakdown ties to item sales exactly", () => {
  it("no tax in eBay's figure: gross = items + shipping", () => {
    const ledger = [tx({ orderId: "A", amt: "28.95", fee: "4.04" })]; // gross 32.99 = 25.00 + 7.99
    const b = salesBreakdown(ledger, P, [{ orderId: "A", itemCents: 2500, shippingCents: 799, taxCents: 210 }]);
    expect(b).toMatchObject({ itemCents: 2500, shippingCents: 799, taxInPayoutCents: 0, otherCents: 0, totalCents: 3299 });
  });
  it("tax included in eBay's figure is shown as pass-through", () => {
    const ledger = [tx({ orderId: "A", amt: "31.05", fee: "4.04" })]; // 35.09 = 25 + 7.99 + 2.10
    const b = salesBreakdown(ledger, P, [{ orderId: "A", itemCents: 2500, shippingCents: 799, taxCents: 210 }]);
    expect(b.taxInPayoutCents).toBe(210);
    expect(b.otherCents).toBe(0);
  });
  it("multi-line orders, unmatched old orders and odd amounts: parts always add up to the line", () => {
    const ledger = [
      tx({ orderId: "M", amt: "50.00", fee: "6.00" }),
      tx({ orderId: "OLD", amt: "10.00", fee: "1.50" }),
      tx({ orderId: "X", amt: "9.99", fee: "1.00" }),
      tx({ orderId: "M", amt: "1.00", fee: "0" }), // second SALE for the same order -> 'other'
    ];
    const lines = [
      { orderId: "M", itemCents: 3000, shippingCents: 1000, taxCents: 0 },
      { orderId: "m", itemCents: 1600, shippingCents: 0, taxCents: 0 },
      { orderId: "X", itemCents: 1000, shippingCents: 0, taxCents: 0 },
    ];
    const b = salesBreakdown(ledger, P, lines);
    const salesLine = buildLedger(ledger, P).lines.find((l) => l.key === "sales")!.cents;
    expect(b.totalCents).toBe(salesLine);
    expect(b.itemCents + b.shippingCents + b.taxInPayoutCents + b.unmatchedCents + b.otherCents).toBe(salesLine);
    expect(b.itemCents).toBe(3000 + 1600 + 1000);
    expect(b.unmatchedCents).toBe(1150);
    expect(b.matchedOrders).toBe(2);
  });
});

describe("disputes", () => {
  it("pairs a dispute with the credit that reversed it and shows net $0", () => {
    const ledger = [
      tx({ orderId: "A", amt: "40.00", fee: "5" }),
      tx({ transactionType: "DISPUTE", orderId: "D1", amt: "107.70", debit: true }),
      tx({ transactionType: "CREDIT", orderId: "D1", amt: "107.70" }),
      tx({ transactionType: "CREDIT", amt: "3.00" }), // unrelated credit stays its own line
    ];
    expect(pairDisputes(ledger, P)).toHaveLength(1);
    const L = buildLedger(ledger, P);
    const lines = displayLines(ledger, P, L, salesBreakdown(ledger, P, [{ orderId: "A", itemCents: 4500, shippingCents: 0, taxCents: 0 }]));
    const resolved = lines.find((l) => l.key === "disputes_resolved")!;
    expect(resolved.cents).toBe(0);
    expect(resolved.note).toMatch(/net \$0/);
    expect(lines.find((l) => l.key === "disputes")).toBeUndefined();
    expect(lines.find((l) => l.key === "credits")!.cents).toBe(300);
    // top-level lines (not the indented sales parts) still add up to eBay's net
    expect(lines.filter((l) => !l.part).reduce((a, l) => a + l.cents, 0)).toBe(L.netCents);
  });
  it("pairs by amount when eBay gives no order id", () => {
    const ledger = [tx({ transactionType: "DISPUTE", amt: "12.00", debit: true }), tx({ transactionType: "CREDIT", amt: "12.00" })];
    expect(pairDisputes(ledger, P)[0].netCents).toBe(0);
  });
  it("an unresolved dispute stays a dispute", () => {
    const ledger = [tx({ transactionType: "DISPUTE", orderId: "Q", amt: "20.00", debit: true })];
    const L = buildLedger(ledger, P);
    expect(displayLines(ledger, P, L, null).find((l) => l.key === "disputes")!.cents).toBe(-2000);
  });
});
