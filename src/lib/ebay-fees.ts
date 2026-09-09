// Shared eBay fee-estimation constants and helpers, used by both the sales
// API route (to compute each sale's estimated fee) and the Settings page
// (to show/validate a seller's own override percentage).
//
// These numbers are NOT pulled from eBay's Finances API -- this app's eBay
// integration is Trading-API-based (GetSellerTransactions) and doesn't have
// the sell.finances OAuth scope that would provide real per-order fee data.
// They're eBay's published STANDARD final value fee schedule for most
// categories, verified via web search Sept 9, 2026. Actual fees vary by
// category (eBay Motors, Books, certain collectibles/watches/bullion, etc.
// have different rates or tiered thresholds), by Store subscription tier,
// and by any seller-specific promotions or adjustments -- so every number
// this produces is an ESTIMATE and must always be labeled as one in the UI,
// never presented as an exact figure or a real invoice line.
//
// Standard final value fee: 13.6% of the total sale amount (item price +
// shipping charged to buyer + tax collected by seller + any handling), for
// most categories, as of the Feb 14, 2025 rate change.
export const EBAY_STANDARD_FEE_PERCENT = 13.6;

// Per-order fixed fee, tiered by order total (unchanged since Mar 15, 2024):
// $0.30 for orders $10.00 or less, $0.40 for orders over $10.00.
export function estimateEbayPerOrderFee(orderTotal: number): number {
  return orderTotal > 10 ? 0.4 : 0.3;
}

// Full estimated final value fee for one sale: percentage cut + fixed fee.
export function estimateEbayFee(orderTotal: number, feePercent: number): number {
  if (orderTotal <= 0) return 0;
  return (orderTotal * feePercent) / 100 + estimateEbayPerOrderFee(orderTotal);
}

// Validates a user-entered override percentage (Settings' "Fee estimate"
// field). Returns false for anything that isn't a finite, sane percentage
// -- callers should reject the request rather than saving garbage that
// would silently wreck every future estimate.
export function isValidFeePercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}
