import { tradingRequest } from "@/lib/ebay-inventory";
import { fetchAllOfListType, isListTypeError, toListing, xmlFind, xmlFindAll } from "@/lib/ebay-listings";

// Moved out of api/ebay/offers/route.ts so the daily-digest cron
// (src/app/api/cron/daily-digest/route.ts) can get a pending-offers count
// as a direct function call instead of duplicating this worker-pool logic
// a second time -- same reasoning as ebay-messages.ts's
// fetchUnansweredQuestions(). Must be called from inside ebayContext.run()
// (see src/lib/ebay-request-context.ts), same requirement as before.

const OFFERS_LOOKUP_CONCURRENCY = 5;
// Upper bound on how many GetBestOffers calls one lookup makes -- otherwise
// it's one call per active listing, unbounded for a seller with hundreds of
// them. Same reasoning and same shape as GALLERY_LOOKUP_MAX in ship/route.ts.
const OFFERS_LOOKUP_MAX = 60;

function makeGetBestOffersXml(itemId: string) {
  return `<?xml version="1.0" encoding="utf-8"?><GetBestOffersRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${itemId}</ItemID></GetBestOffersRequest>`;
}

interface ActiveListingInfo {
  listingId: string;
  title: string;
  thumbnail: string | null;
  price: number | null;
}

export interface PendingOffer {
  itemId: string;
  title: string;
  thumbnail: string | null;
  askingPrice: number | null;
  bestOfferId: string;
  buyerUserId: string | null;
  offerPrice: number | null;
  quantity: number;
  expirationTime: string | null;
  buyerMessage: string | null;
}

// Within a GetBestOffers response, "Pending" is the status meaning "awaiting
// the seller's response, can still be accepted/declined/countered" -- verified
// against eBay's own BestOfferStatusCodeType reference. "Active" also exists
// as an enum value but documents a different meaning elsewhere; using it here
// would silently show zero actionable offers. Every other status (Accepted,
// Declined, Expired, Countered, Retracted, ...) is already resolved.
const ACTIONABLE_STATUS = "Pending";

async function fetchOffersForListing(listing: ActiveListingInfo): Promise<PendingOffer[]> {
  try {
    const { body } = await tradingRequest("GetBestOffers", makeGetBestOffersXml(listing.listingId));
    if (!body.includes("<Ack>Success</Ack>") && !body.includes("<Ack>Warning</Ack>")) {
      return [];
    }
    const arrayBlock = xmlFind(body, "BestOfferArray");
    if (!arrayBlock) return [];
    return xmlFindAll(arrayBlock, "BestOffer")
      .filter((block) => xmlFind(block, "Status") === ACTIONABLE_STATUS)
      .map((block) => {
        const buyerBlock = xmlFind(block, "Buyer");
        const priceStr = xmlFind(block, "Price");
        return {
          itemId: listing.listingId,
          title: listing.title,
          thumbnail: listing.thumbnail,
          askingPrice: listing.price,
          bestOfferId: xmlFind(block, "BestOfferID"),
          buyerUserId: xmlFind(buyerBlock, "UserID") || null,
          offerPrice: priceStr ? parseFloat(priceStr) : null,
          quantity: parseInt(xmlFind(block, "Quantity") || "1", 10),
          expirationTime: xmlFind(block, "ExpirationTime") || null,
          buyerMessage: xmlFind(block, "BuyerMessage") || null,
        };
      })
      .filter((o) => o.bestOfferId);
  } catch {
    return [];
  }
}

export interface FetchPendingOffersResult {
  offers: PendingOffer[];
  listingsChecked: number;
  truncated: boolean;
}

export type FetchPendingOffersOutcome =
  | FetchPendingOffersResult
  | { error: string; connect: boolean; reconnect: boolean };

export async function fetchPendingOffers(): Promise<FetchPendingOffersOutcome> {
  const activeResult = await fetchAllOfListType("ActiveList");
  if (isListTypeError(activeResult)) {
    return activeResult;
  }

  const activeListings: ActiveListingInfo[] = activeResult.items
    .map((item) => toListing(item, "active"))
    .filter((l) => l.listingId)
    .map((l) => ({ listingId: l.listingId, title: l.title, thumbnail: l.thumbnail, price: l.price }));

  const truncated = activeListings.length > OFFERS_LOOKUP_MAX;
  const toCheck = activeListings.slice(0, OFFERS_LOOKUP_MAX);

  const offersByListing = new Map<string, PendingOffer[]>();
  let cursor = 0;
  async function worker() {
    while (cursor < toCheck.length) {
      const listing = toCheck[cursor++];
      offersByListing.set(listing.listingId, await fetchOffersForListing(listing));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(OFFERS_LOOKUP_CONCURRENCY, toCheck.length) }, () => worker())
  );

  const offers = toCheck.flatMap((l) => offersByListing.get(l.listingId) ?? []);

  return { offers, listingsChecked: toCheck.length, truncated };
}
