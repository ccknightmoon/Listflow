// Turns one GetSellerTransactions <Transaction> block into a normalized
// sale record for the Sales analytics page. Pure (string in, object out)
// so the money rules are unit-tested without eBay.
//
// Money definitions used everywhere on the analytics page:
//   itemTotal   = TransactionPrice x QuantityPurchased  (item sales only)
//   shippingPaid = what the buyer paid for shipping (ActualShippingCost)
//   taxPaid      = sales tax collected by eBay (Taxes/TotalTaxAmount)
// Headline "Item sales" EXCLUDES shipping and tax. eBay's final value fee
// is charged on item + shipping + tax, so the fee estimate uses all three.

export function xmlFind(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m?.[1]?.trim() ?? "";
}

export function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function num(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// eBay CancelStatusCodeType values that mean the sale did not happen (or
// was fully reversed). Pending/requested/rejected cancellations still count
// as sales until eBay closes them.
export const CANCELLED_STATUSES = new Set([
  "CancelComplete",
  "CancelClosedWithRefund",
  "CancelClosedUnknownRefund",
  "CancelClosedNoRefund",
  "CancelClosedForCommitment",
]);

export type SaleStatus = "paid" | "awaiting_payment" | "cancelled";

export interface ParsedSale {
  key: string; // `${listingId}-${transactionId}`, unique per sale line
  listingId: string;
  transactionId: string;
  orderId: string | null;
  title: string;
  sku: string | null;
  price: number;
  qty: number;
  itemTotal: number;
  shippingPaid: number;
  taxPaid: number;
  soldAt: string;
  paidAt: string | null;
  listedAt: string | null; // eBay ListingDetails.StartTime, when returned
  ebayCategory: string | null; // leaf of PrimaryCategory.CategoryName
  status: SaleStatus;
}

export function leafCategoryName(path: string): string | null {
  const parts = decodeXml(path).split(":").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

export function parseTransaction(tx: string): ParsedSale | null {
  const item = xmlFind(tx, "Item");
  const listingId = xmlFind(item, "ItemID");
  const transactionId = xmlFind(tx, "TransactionID");
  const soldAt = xmlFind(tx, "CreatedDate");
  if (!listingId || !soldAt || Number.isNaN(Date.parse(soldAt))) return null;

  const price = num(xmlFind(tx, "TransactionPrice"));
  const qtyRaw = parseInt(xmlFind(tx, "QuantityPurchased") || "1", 10);
  const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
  if (price <= 0) return null;

  const order = xmlFind(tx, "ContainingOrder");
  const status = xmlFind(tx, "Status");
  const cancelStatus = xmlFind(order, "CancelStatus") || xmlFind(status, "CancelStatus");
  const paidAt = xmlFind(tx, "PaidTime") || null;
  const checkout = xmlFind(status, "CheckoutStatus");
  const complete = xmlFind(status, "CompleteStatus");

  let saleStatus: SaleStatus = "paid";
  if (CANCELLED_STATUSES.has(cancelStatus)) saleStatus = "cancelled";
  else if (!paidAt && checkout !== "CheckoutComplete" && complete !== "Complete") saleStatus = "awaiting_payment";

  const orderId =
    xmlFind(tx, "ExtendedOrderID") ||
    xmlFind(order, "OrderID") ||
    xmlFind(tx, "OrderLineItemID") ||
    null;

  const category = xmlFind(xmlFind(item, "PrimaryCategory"), "CategoryName");

  return {
    key: `${listingId}-${transactionId}`,
    listingId,
    transactionId,
    orderId,
    title: decodeXml(xmlFind(item, "Title") || xmlFind(tx, "Title")),
    sku: xmlFind(item, "SKU") || null,
    price,
    qty,
    itemTotal: Math.round(price * qty * 100) / 100,
    shippingPaid: num(xmlFind(tx, "ActualShippingCost") || xmlFind(xmlFind(tx, "ShippingServiceSelected"), "ShippingServiceCost")),
    taxPaid: num(xmlFind(xmlFind(tx, "Taxes"), "TotalTaxAmount")),
    soldAt,
    paidAt,
    listedAt: xmlFind(xmlFind(item, "ListingDetails"), "StartTime") || null,
    ebayCategory: category ? leafCategoryName(category) : null,
    status: saleStatus,
  };
}

/** Parse + de-duplicate transactions from several (possibly overlapping) responses. */
export function parseTransactions(blocks: string[]): ParsedSale[] {
  const seen = new Map<string, ParsedSale>();
  for (const b of blocks) {
    const s = parseTransaction(b);
    if (s && !seen.has(s.key)) seen.set(s.key, s);
  }
  return [...seen.values()].sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt));
}
