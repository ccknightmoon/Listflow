// eBay Negotiation API: send a discount offer to buyers who are watching /
// interested in a listing. Often a better first move on a stale item than
// a public price cut -- only interested buyers see the lower price.
import { inventoryRequest } from "./ebay-inventory";

const MARKET = { "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" };
export const OFFER_DISCOUNTS = [10, 15, 20] as const;

export function isValidOfferDiscount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 5 && n <= 80;
}

export function buildOfferBody(listingId: string, discountPercentage: number, message?: string) {
  return {
    allowCounterOffer: false,
    message: (message ?? "Thanks for your interest — here's a special price, just for you.").slice(0, 2000),
    offerDuration: { unit: "DAY", value: 2 },
    offeredItems: [{ listingId, discountPercentage: String(discountPercentage), quantity: 1 }],
  };
}

/** Listing ids eBay says can get an offer right now (they have interested buyers). null = not available. */
export async function fetchEligibleListingIds(): Promise<Set<string> | null> {
  const ids = new Set<string>();
  for (let offset = 0, page = 0; page < 10; page++) {
    const { status, data } = await inventoryRequest("GET", `/sell/negotiation/v1/find_eligible_items?limit=200&offset=${offset}`, undefined, MARKET);
    if (status === 204) break; // nothing eligible
    if (status >= 400) return null;
    const list = (data as { eligibleItems?: Array<{ listingId?: string }> }).eligibleItems ?? [];
    for (const it of list) if (it.listingId) ids.add(it.listingId);
    const total = (data as { total?: number }).total ?? 0;
    offset += list.length;
    if (list.length === 0 || offset >= total) break;
  }
  return ids;
}

export async function sendOfferToInterestedBuyers(listingId: string, discountPercentage: number, message?: string) {
  const { status, data } = await inventoryRequest("POST", "/sell/negotiation/v1/send_offer_to_interested_buyers", buildOfferBody(listingId, discountPercentage, message), MARKET);
  if (status >= 400) {
    const err = (data as { errors?: Array<{ message?: string; longMessage?: string }> }).errors?.[0];
    return { ok: false as const, status, error: err?.longMessage ?? err?.message ?? `eBay rejected the offer (HTTP ${status}).` };
  }
  const offers = (data as { offers?: Array<{ offerId?: string }> }).offers ?? [];
  return { ok: true as const, sent: offers.length };
}
