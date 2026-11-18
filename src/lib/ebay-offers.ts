import { tradingRequest } from "@/lib/ebay-inventory";
import { fetchAllOfListType, isListTypeError, toListing, xmlFind, xmlFindAll } from "@/lib/ebay-listings";
import { decodeEntities } from "@/lib/html-entities";

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

// ---------------------------------------------------------------------------
// Seller-wide lookup (Nov 2026 audit fix). GetBestOffers with NO ItemID
// returns Best Offers across ALL of the seller's listings, paginated. This
// replaces "one call per listing, first 60 listings only", which missed
// offers on ~95% of a 1,000+ listing store.

const SELLER_WIDE_PAGE_SIZE = 200;
const SELLER_WIDE_MAX_PAGES = 25;

function makeSellerWideXml(page: number) {
  return `<?xml version="1.0" encoding="utf-8"?><GetBestOffersRequest xmlns="urn:ebay:apis:eBLBaseComponents"><BestOfferStatus>Active</BestOfferStatus><DetailLevel>ReturnAll</DetailLevel><Pagination><EntriesPerPage>${SELLER_WIDE_PAGE_SIZE}</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></GetBestOffersRequest>`;
}

export interface RawSellerOffer {
  itemId: string;
  itemTitle: string | null;
  itemPrice: number | null;
  bestOfferId: string;
  buyerUserId: string | null;
  offerPrice: number | null;
  quantity: number;
  expirationTime: string | null;
  buyerMessage: string | null;
}

function parseOfferBlock(block: string, itemId: string, itemTitle: string | null, itemPrice: number | null): RawSellerOffer | null {
  if (xmlFind(block, "Status") !== ACTIONABLE_STATUS) return null;
  const id = xmlFind(block, "BestOfferID");
  if (!id) return null;
  const priceStr = xmlFind(block, "Price");
  const qty = parseInt(xmlFind(block, "Quantity") || "1", 10);
  return {
    itemId,
    itemTitle,
    itemPrice,
    bestOfferId: id,
    buyerUserId: xmlFind(xmlFind(block, "Buyer"), "UserID") || null,
    offerPrice: priceStr ? parseFloat(priceStr) : null,
    quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
    expirationTime: xmlFind(block, "ExpirationTime") || null,
    buyerMessage: decodeEntities(xmlFind(block, "BuyerMessage")) || null,
  };
}

/**
 * Parses one page of a seller-wide GetBestOffers response:
 * ItemBestOffersArray > ItemBestOffers > { Item, BestOfferArray > BestOffer }.
 * Also accepts the single-item shape (Item + BestOfferArray at top level).
 */
export function parseSellerBestOffers(body: string): { offers: RawSellerOffer[]; totalPages: number } {
  const totalPages = parseInt(xmlFind(xmlFind(body, "PaginationResult"), "TotalNumberOfPages") || "1", 10) || 1;
  const groups = xmlFindAll(xmlFind(body, "ItemBestOffersArray"), "ItemBestOffers");
  const blocks = groups.length ? groups : [body];
  const offers: RawSellerOffer[] = [];
  for (const g of blocks) {
    const item = xmlFind(g, "Item");
    const itemId = xmlFind(item, "ItemID");
    if (!itemId) continue;
    const title = decodeEntities(xmlFind(item, "Title")) || null;
    const priceStr = xmlFind(xmlFind(item, "SellingStatus"), "CurrentPrice") || xmlFind(item, "BuyItNowPrice");
    const price = priceStr ? parseFloat(priceStr) : NaN;
    for (const b of xmlFindAll(xmlFind(g, "BestOfferArray"), "BestOffer")) {
      const o = parseOfferBlock(b, itemId, title, Number.isFinite(price) ? price : null);
      if (o) offers.push(o);
    }
  }
  return { offers, totalPages };
}

const ok = (body: string) => body.includes("<Ack>Success</Ack>") || body.includes("<Ack>Warning</Ack>");

/** Every pending Best Offer across all listings, or null if eBay refused the seller-wide call. */
async function fetchSellerWideOffers(): Promise<RawSellerOffer[] | null> {
  const first = await tradingRequest("GetBestOffers", makeSellerWideXml(1));
  if (!ok(first.body)) return null;
  const p1 = parseSellerBestOffers(first.body);
  const pages = Math.min(p1.totalPages, SELLER_WIDE_MAX_PAGES);
  const all = [...p1.offers];
  for (let page = 2; page <= pages; page++) {
    const r = await tradingRequest("GetBestOffers", makeSellerWideXml(page));
    if (!ok(r.body)) break;
    all.push(...parseSellerBestOffers(r.body).offers);
  }
  const seen = new Set<string>();
  return all.filter((o) => (seen.has(o.bestOfferId) ? false : (seen.add(o.bestOfferId), true)));
}

export async function fetchPendingOffers(): Promise<FetchPendingOffersOutcome> {
  const activeResult = await fetchAllOfListType("ActiveList");
  if (isListTypeError(activeResult)) {
    return activeResult;
  }

  const activeListings: ActiveListingInfo[] = activeResult.items
    .map((item) => toListing(item, "active"))
    .filter((l) => l.listingId)
    .map((l) => ({ listingId: l.listingId, title: l.title, thumbnail: l.thumbnail, price: l.price }));
  const byId = new Map(activeListings.map((l) => [l.listingId, l]));

  // 1) Seller-wide: covers 100% of listings in a handful of calls.
  const sellerWide = await fetchSellerWideOffers().catch(() => null);
  if (sellerWide) {
    const offers: PendingOffer[] = sellerWide.map((o) => {
      const l = byId.get(o.itemId);
      return {
        itemId: o.itemId,
        title: l?.title ?? o.itemTitle ?? "Listing",
        thumbnail: l?.thumbnail ?? null,
        askingPrice: l?.price ?? o.itemPrice,
        bestOfferId: o.bestOfferId,
        buyerUserId: o.buyerUserId,
        offerPrice: o.offerPrice,
        quantity: o.quantity,
        expirationTime: o.expirationTime,
        buyerMessage: o.buyerMessage,
      };
    });
    return { offers, listingsChecked: activeListings.length, truncated: false };
  }

  // 2) Fallback (eBay refused the seller-wide call): per listing, capped.
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

/**
 * Just the number of pending offers, for the dashboard. Uses the
 * seller-wide call alone (no full active-listings pull); falls back to the
 * full lookup only if eBay refuses the seller-wide call.
 */
export async function countPendingOffers(): Promise<number | null> {
  const sellerWide = await fetchSellerWideOffers().catch(() => null);
  if (sellerWide) return sellerWide.length;
  const full = await fetchPendingOffers();
  return "offers" in full ? full.offers.length : null;
}
