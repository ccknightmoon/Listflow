import { describe, it, expect, vi } from "vitest";

const inv = vi.hoisted(() => ({ calls: [] as Array<[string, string, unknown]> }));
vi.mock("@/lib/ebay-inventory", async (orig) => {
  const real = await orig<typeof import("@/lib/ebay-inventory")>();
  return {
    ...real,
    getOfferBySku: vi.fn(async () => ({ status: 200, data: { offers: [{ offerId: "O1", listing: { listingId: "256000000001" } }] } })),
    inventoryRequest: vi.fn(async (m: string, p: string, b: unknown) => { inv.calls.push([m, p, b]); return { status: 200, data: { responses: [{ statusCode: 200 }] } }; }),
  };
});
vi.mock("@/lib/ebay-item", () => ({ getLiveItem: vi.fn(async () => ({ sku: "1001" })) }));

import { isInventoryModelResponse, updateInventoryListingPrice } from "@/lib/legacy-inventory";

describe("legacy Inventory-API listings", () => {
  it("recognises eBay's 'inventory-based listing' refusal", () => {
    expect(isInventoryModelResponse("<R><Ack>Failure</Ack><Errors><ShortMessage>Inventory-based listing management is not currently supported by this tool.</ShortMessage><ErrorCode>21919474</ErrorCode><SeverityCode>Error</SeverityCode></Errors></R>")).toBe(true);
    expect(isInventoryModelResponse("<R><Ack>Success</Ack></R>")).toBe(false);
  });
  it("changes the price through the listing's offer", async () => {
    expect(await updateInventoryListingPrice("256000000001", 19.5, null)).toEqual({ success: true });
    expect(inv.calls[0]).toEqual(["POST", "/sell/inventory/v1/bulk_update_price_quantity", { requests: [{ offers: [{ offerId: "O1", price: { value: "19.50", currency: "USD" } }] }] }]);
  });
});
