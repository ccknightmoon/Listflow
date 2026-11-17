import { describe, it, expect } from "vitest";
import { allocateActualFees, extractFinanceExtras, type FinanceTx } from "./finance-match";
import { parseTransaction, parseTransactions, leafCategoryName } from "./sales-parse";

const tx = (o: Partial<FinanceTx>): FinanceTx => ({ type: "SALE", orderId: null, date: "2026-11-10T00:00:00Z", fee: 0, amount: 0, bookingEntry: "CREDIT", ...o });

describe("allocateActualFees", () => {
  it("matches a single-line order by order id (case-insensitive)", () => {
    const m = allocateActualFees([{ key: "a", orderId: "12-345-678", itemTotal: 20, shippingPaid: 5, taxPaid: 0 }], [tx({ orderId: "12-345-678", fee: 4.1 })]);
    expect(m.get("a")).toBe(4.1);
  });
  it("splits a multi-line order's fee by fee base and keeps the total exact", () => {
    const m = allocateActualFees([
      { key: "a", orderId: "o1", itemTotal: 30, shippingPaid: 0, taxPaid: 0 },
      { key: "b", orderId: "o1", itemTotal: 10, shippingPaid: 0, taxPaid: 0 },
    ], [tx({ orderId: "O1", fee: 5.01 })]);
    expect(m.get("a")).toBe(3.76);
    expect((m.get("a") ?? 0) + (m.get("b") ?? 0)).toBeCloseTo(5.01, 2);
  });
  it("leaves unmatched sales out (they fall back to the estimate)", () => {
    const m = allocateActualFees([{ key: "a", orderId: "x", itemTotal: 1, shippingPaid: 0, taxPaid: 0 }, { key: "b", orderId: null, itemTotal: 1, shippingPaid: 0, taxPaid: 0 }], [tx({ orderId: "y", fee: 1 })]);
    expect(m.size).toBe(0);
  });
  it("ignores refunds and other non-SALE transactions for fees", () => {
    const m = allocateActualFees([{ key: "a", orderId: "o", itemTotal: 1, shippingPaid: 0, taxPaid: 0 }], [tx({ type: "REFUND", orderId: "o", fee: 9 })]);
    expect(m.size).toBe(0);
  });
});

describe("extractFinanceExtras", () => {
  it("collects refunds, label costs (credits reduce) and other charges", () => {
    const e = extractFinanceExtras([
      tx({ type: "REFUND", amount: 12, bookingEntry: "DEBIT" }),
      tx({ type: "SHIPPING_LABEL", amount: 5.5, bookingEntry: "DEBIT" }),
      tx({ type: "SHIPPING_LABEL", amount: 5.5, bookingEntry: "CREDIT" }),
      tx({ type: "NON_SALE_CHARGE", amount: 1.25, bookingEntry: "DEBIT" }),
      tx({ type: "SALE", amount: 20 }),
    ]);
    expect(e.refunds).toEqual([{ date: "2026-11-10T00:00:00Z", amount: 12 }]);
    expect(e.labels.map((l) => l.amount)).toEqual([5.5, -5.5]);
    expect(e.otherCharges.map((l) => l.amount)).toEqual([1.25]);
  });
});

const TX = (extra = "", status = "<Status><CheckoutStatus>CheckoutComplete</CheckoutStatus><CompleteStatus>Complete</CompleteStatus></Status>") => `
  <Item><ItemID>1234567890</ItemID><Title>Vtg Nike Tee &amp; Hat</Title>
    <PrimaryCategory><CategoryID>15687</CategoryID><CategoryName>Clothing, Shoes &amp; Accessories:Men:Men's Clothing:Shirts:T-Shirts</CategoryName></PrimaryCategory>
    <ListingDetails><StartTime>2026-11-01T10:00:00.000Z</StartTime></ListingDetails></Item>
  <QuantityPurchased>2</QuantityPurchased><TransactionID>999</TransactionID>
  <TransactionPrice currencyID="USD">12.50</TransactionPrice>
  <ActualShippingCost currencyID="USD">6.00</ActualShippingCost>
  <Taxes><TotalTaxAmount currencyID="USD">2.10</TotalTaxAmount></Taxes>
  <CreatedDate>2026-11-10T15:00:00.000Z</CreatedDate><PaidTime>2026-11-10T15:05:00.000Z</PaidTime>
  <ExtendedOrderID>11-11111-22222</ExtendedOrderID>
  ${status}${extra}`;

describe("parseTransaction", () => {
  it("reads quantity, totals, shipping, tax, order id, eBay category and listing start", () => {
    const s = parseTransaction(TX())!;
    expect(s).toMatchObject({
      listingId: "1234567890", qty: 2, price: 12.5, itemTotal: 25, shippingPaid: 6, taxPaid: 2.1,
      orderId: "11-11111-22222", ebayCategory: "T-Shirts", listedAt: "2026-11-01T10:00:00.000Z",
      status: "paid", title: "Vtg Nike Tee & Hat",
    });
  });
  it("flags cancelled orders", () => {
    expect(parseTransaction(TX("<ContainingOrder><OrderID>x</OrderID><CancelStatus>CancelComplete</CancelStatus></ContainingOrder>"))!.status).toBe("cancelled");
  });
  it("a pending cancel request still counts as a sale", () => {
    expect(parseTransaction(TX("<ContainingOrder><CancelStatus>CancelRequested</CancelStatus></ContainingOrder>"))!.status).toBe("paid");
  });
  it("flags unpaid sales", () => {
    const unpaid = TX("", "<Status><CheckoutStatus>CheckoutIncomplete</CheckoutStatus><CompleteStatus>Incomplete</CompleteStatus></Status>").replace(/<PaidTime>.*?<\/PaidTime>/, "");
    expect(parseTransaction(unpaid)!.status).toBe("awaiting_payment");
  });
  it("drops zero-price lines and de-duplicates across overlapping windows", () => {
    expect(parseTransaction(TX().replace("12.50", "0"))).toBeNull();
    expect(parseTransactions([TX(), TX()])).toHaveLength(1);
  });
  it("takes the leaf of eBay's category path", () => {
    expect(leafCategoryName("A:B:Men's Jeans")).toBe("Men's Jeans");
  });
});
