// Fallbacks for listings created earlier with the Inventory API (Trading
// can't revise those: error 21919474). Server only; needs an eBay context.
import { inventoryRequest, getOfferBySku } from "@/lib/ebay-inventory";
import { getLiveItem } from "@/lib/ebay-item";
import { parseTradingResponse, isInventoryModelError } from "@/lib/trading-listing";

/** True when a raw Trading response says the listing is an Inventory-API listing. */
export function isInventoryModelResponse(xml: string): boolean {
  return isInventoryModelError(parseTradingResponse(xml));
}

/** Price change for an Inventory-API listing: find its offer by SKU, update price in place. */
export async function updateInventoryListingPrice(listingId: string, price: number, knownSku?: string | null): Promise<{ success: boolean; error?: string }> {
  let sku = knownSku ?? null;
  if (!sku) {
    const live = await getLiveItem(listingId);
    sku = "error" in live ? null : live.sku;
  }
  if (!sku) return { success: false, error: "This listing was made with eBay's Inventory API and has no SKU Listflow can find." };
  const offers = ((await getOfferBySku(sku)).data as { offers?: Array<{ offerId: string; listing?: { listingId?: string } }> }).offers ?? [];
  const offer = offers.find((o) => o.listing?.listingId === listingId) ?? offers[0];
  if (!offer) return { success: false, error: "Couldn't find this listing's Inventory API offer." };
  const res = await inventoryRequest("POST", "/sell/inventory/v1/bulk_update_price_quantity", {
    requests: [{ offers: [{ offerId: offer.offerId, price: { value: price.toFixed(2), currency: "USD" } }] }],
  });
  const r0 = (res.data as { responses?: Array<{ statusCode?: number; errors?: Array<{ message?: string }> }> }).responses?.[0];
  if (res.status >= 400 || (r0?.statusCode && r0.statusCode >= 400)) {
    return { success: false, error: r0?.errors?.[0]?.message ?? `eBay price update failed (${res.status})` };
  }
  return { success: true };
}
