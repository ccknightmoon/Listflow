import { describe, it, expect } from "vitest";
import { shipState } from "./ship-status";

const tx = (inner: string) => `<Item><ItemID>1</ItemID><Title>Hat</Title></Item><TransactionID>9</TransactionID><PaidTime>2026-11-01T10:00:00Z</PaidTime>${inner}`;

describe("To ship: only truly unshipped orders", () => {
  it("paid, no ship date, no tracking -> to ship", () => {
    expect(shipState(tx(""))).toBe("awaiting");
  });
  it("marked shipped on the line or the order", () => {
    expect(shipState(tx("<ShippedTime>2026-11-02T00:00:00Z</ShippedTime>"))).toBe("shipped");
    expect(shipState(tx("<ContainingOrder><OrderID>A</OrderID><ShippedTime>2026-11-02T00:00:00Z</ShippedTime></ContainingOrder>"))).toBe("shipped");
  });
  it("tracking uploaded from a label bought elsewhere", () => {
    expect(shipState(tx("<ShippingDetails><ShipmentTrackingDetails><ShippingCarrierUsed>USPS</ShippingCarrierUsed><ShipmentTrackingNumber>9400111</ShipmentTrackingNumber></ShipmentTrackingDetails></ShippingDetails>"))).toBe("shipped");
    expect(shipState(tx("<ContainingOrder><ShippingDetails><ShipmentTrackingDetails><ShipmentTrackingNumber>1Z999</ShipmentTrackingNumber></ShipmentTrackingDetails></ShippingDetails></ContainingOrder>"))).toBe("shipped");
  });
  it("an empty tracking tag doesn't count", () => {
    expect(shipState(tx("<ShippingDetails><ShipmentTrackingDetails><ShipmentTrackingNumber></ShipmentTrackingNumber></ShipmentTrackingDetails></ShippingDetails>"))).toBe("awaiting");
  });
  it("an eBay label in Finances for that order", () => {
    expect(shipState(tx("<ExtendedOrderID>12-345-678</ExtendedOrderID>"), new Set(["12-345-678"]))).toBe("shipped");
    expect(shipState(tx("<ExtendedOrderID>12-345-678</ExtendedOrderID>"), new Set(["99-000"]))).toBe("awaiting");
  });
  it("cancelled and unpaid orders never show", () => {
    expect(shipState(tx("<ContainingOrder><CancelStatus>CancelComplete</CancelStatus></ContainingOrder>"))).toBe("cancelled");
    expect(shipState("<Item><ItemID>1</ItemID></Item>")).toBe("unpaid");
  });
});
