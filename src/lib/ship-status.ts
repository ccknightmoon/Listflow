// Decides, per order line, whether it still needs shipping. Pure + tested.
//
// An order is DONE (leaves "To ship") the moment ANY of these is true:
//   - eBay recorded a ship date (line ShippedTime or the order's ShippedTime)
//     -- set when it's marked shipped, or an eBay label is bought;
//   - a tracking number is on the line or the order (labels bought
//     elsewhere with tracking uploaded);
//   - eBay Finances shows a shipping label bought for that order;
//   - the order was cancelled.
// Only paid, not-cancelled lines with none of the above are "to ship".
import { CANCELLED_STATUSES, xmlFind } from "./sales-parse";

export type ShipState = "awaiting" | "shipped" | "unpaid" | "cancelled";

function hasTracking(block: string): boolean {
  if (!block) return false;
  const re = /<ShipmentTrackingNumber>\s*([^<\s][^<]*)<\/ShipmentTrackingNumber>/;
  return re.test(block);
}

export function orderIdOf(tx: string): string | null {
  const order = xmlFind(tx, "ContainingOrder");
  return xmlFind(tx, "ExtendedOrderID") || xmlFind(order, "OrderID") || xmlFind(tx, "OrderLineItemID") || null;
}

export function shipState(tx: string, ordersWithEbayLabel?: Set<string>): ShipState {
  const order = xmlFind(tx, "ContainingOrder");
  const status = xmlFind(tx, "Status");
  const cancel = xmlFind(order, "CancelStatus") || xmlFind(status, "CancelStatus");
  if (CANCELLED_STATUSES.has(cancel)) return "cancelled";
  if (xmlFind(tx, "ShippedTime") || xmlFind(order, "ShippedTime")) return "shipped";
  if (hasTracking(xmlFind(tx, "ShippingDetails")) || hasTracking(xmlFind(order, "ShippingDetails")) || hasTracking(tx)) return "shipped";
  const id = orderIdOf(tx);
  if (id && ordersWithEbayLabel?.has(id.toUpperCase())) return "shipped";
  if (!xmlFind(tx, "PaidTime") && !xmlFind(order, "PaidTime")) return "unpaid";
  return "awaiting";
}
