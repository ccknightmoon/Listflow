import { NextResponse } from "next/server";
import { tradingRequest } from "@/lib/ebay-inventory";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { fetchAllOfListType, isListTypeError, toListing, xmlFind } from "@/lib/ebay-listings";

export const runtime = "nodejs";

function xmlFindAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const results: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

const OFFERS_LOOKUP_CONCURRENCY = 5;
// Upper bound on how many GetBestOffers calls one /offers page load makes --
// otherwise it's one call per active listing, unbounded for a seller with
// hundreds of them. Same reasoning and same shape as GALLERY_LOOKUP_MAX in
// sales/route.ts.
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

interface PendingOffer {
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

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ error: "eBay not connected.", connect: true }, { status: 502 });
  }

  return ebayContext.run(connection, async () => {
    try {
      const activeResult = await fetchAllOfListType("ActiveList");
      if (isListTypeError(activeResult)) {
        return NextResponse.json(activeResult, { status: 502 });
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

      return NextResponse.json({
        offers,
        listingsChecked: toCheck.length,
        truncated,
      });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
