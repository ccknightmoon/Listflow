import { tradingRequest } from "@/lib/ebay-inventory";
import { getEbayContext } from "@/lib/ebay-request-context";
import { createTtlDedupeCache } from "@/lib/ttl-cache";

// Shared XML helpers + eBay "My eBay Selling" listing-fetch logic, used by
// both /api/ebay/store (all active/unsold listings) and /api/ebay/offers
// (Best Offer lookups need each active listing's ItemID/title/thumbnail
// too, to join against). Extracted from store/route.ts so a third caller
// doesn't mean a third copy-pasted set of XML-parsing helpers -- there were
// already near-duplicates of these in sales/route.ts and store/route.ts.
// store/route.ts's own behavior is unchanged by this extraction, just
// re-imported from here.

export function xmlFind(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m?.[1]?.trim() ?? "";
}

// Same idea as xmlFind but for a repeated sibling tag (e.g. every <Question>
// in a GetMemberMessages response, every <BestOffer> in a GetBestOffers
// response) -- moved here after this exact same regex loop turned up
// copy-pasted, near-identically, in both offers/route.ts and
// ebay-messages.ts, the same duplication this file's header comment
// already exists to avoid for xmlFind.
export function xmlFindAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const results: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

export function extractItemBlocks(xml: string): string[] {
  const arrayBlock = xmlFind(xml, "ItemArray");
  if (!arrayBlock) return [];
  const items: string[] = [];
  const re = /<Item[^>]*>([\s\S]*?)<\/Item>/g;
  let m;
  while ((m = re.exec(arrayBlock)) !== null) items.push(m[1]);
  return items;
}

const ENTRIES_PER_PAGE = 200;
// Hard ceiling on how many pages we'll fetch per list type, purely as a
// safety backstop against a runaway loop — 50 * 200 = 10,000 listings.
const MAX_PAGES = 50;

export type ListType = "ActiveList" | "UnsoldList";

export async function fetchListPage(listType: ListType, page: number) {
  return tradingRequest(
    "GetMyeBaySelling",
    `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><${listType}><Include>true</Include><Pagination><EntriesPerPage>${ENTRIES_PER_PAGE}</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></${listType}><DetailLevel>ReturnSummary</DetailLevel></GetMyeBaySellingRequest>`
  );
}

export interface ListTypeError {
  error: string;
  connect: boolean;
  reconnect: boolean;
}

export function isListTypeError(r: unknown): r is ListTypeError {
  return typeof r === "object" && r !== null && "error" in r;
}

// Fetches every page of one list type (Active or Unsold) — same pagination
// pattern used for both, so accounts with >200 listings of either kind don't
// silently lose everything past page 1. UnsoldList = listings that ended
// without selling (eBay only retains a recent window of these, not full
// history — there's no way to widen that from our side).
async function fetchAllOfListTypeUncached(listType: ListType): Promise<{ items: string[]; total: number } | ListTypeError> {
  const { status, body } = await fetchListPage(listType, 1);

  if (status >= 400) {
    return { error: `Trading API HTTP ${status}: ${body.slice(0, 300)}`, connect: false, reconnect: false };
  }
  if (body.includes("<Ack>Failure</Ack>")) {
    const errMsg =
      body.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1] ??
      body.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/)?.[1] ??
      body.slice(0, 300);
    // "Not connected" is now checked up front in each caller via
    // requireEbayConnection() before this function ever runs, so a Trading
    // API auth failure reaching here means a revoked/expired token, not a
    // never-connected account.
    const isAuth = errMsg.toLowerCase().includes("auth") || errMsg.toLowerCase().includes("token") || errMsg.toLowerCase().includes("permission");
    return { error: `eBay error: ${errMsg}`, connect: false, reconnect: isAuth };
  }

  const total = parseInt(xmlFind(body, "TotalNumberOfEntries") || "0", 10);
  const totalPages = Math.min(parseInt(xmlFind(body, "TotalNumberOfPages") || "1", 10) || 1, MAX_PAGES);

  let items = extractItemBlocks(body);
  if (totalPages > 1) {
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const remainingResults = await Promise.all(remainingPages.map((p) => fetchListPage(listType, p)));
    for (const res of remainingResults) {
      if (res.status < 400 && res.body.includes("<Ack>Success</Ack>")) {
        items = items.concat(extractItemBlocks(res.body));
      }
    }
  }

  return { items, total: total || items.length };
}

// A single Dashboard load fans out to /api/dashboard/stats, /api/ebay/offers,
// /api/ebay/messages, and /api/ebay/store nearly simultaneously -- and
// offers, messages, and store all independently call
// fetchAllOfListTypeUncached("ActiveList") to get essentially the same
// "every active listing" snapshot. Without this, one dashboard view could
// mean 3+ near-duplicate GetMyeBaySelling round trips to eBay at once.
// createTtlDedupeCache (src/lib/ttl-cache.ts) is the same "thundering
// herd" fix as getAccessToken() in ebay-oauth.ts, pulled out as its own
// generic, unit-tested module rather than a one-off Map pair here.
//
// TTL is deliberately short (15s, not the 2-minute client-side page-cache
// window in src/lib/page-cache.ts) -- this backs server-side reads that
// should still reflect a listing edited moments ago; it only exists to
// collapse requests that land within the same page load, not to replace a
// real refresh.
const LISTINGS_CACHE_TTL_MS = 15_000;
type ListingsResult = { items: string[]; total: number } | ListTypeError;
const listingsCache = createTtlDedupeCache<ListingsResult>();

export async function fetchAllOfListType(listType: ListType): Promise<ListingsResult> {
  const { userId } = getEbayContext();
  const cacheKey = `${userId}:${listType}`;

  return listingsCache.get(
    cacheKey,
    LISTINGS_CACHE_TTL_MS,
    () => fetchAllOfListTypeUncached(listType),
    // Don't cache a failure -- a transient eBay error shouldn't be
    // replayed to every other concurrent caller for the next 15s.
    (result) => !isListTypeError(result)
  );
}

export function toListing(item: string, status: "active" | "ended") {
  const listingId = xmlFind(item, "ItemID");
  const title = xmlFind(item, "Title") || "Untitled";
  // Ended listings don't carry CurrentPrice — fall back to StartPrice.
  const priceStr = xmlFind(item, "CurrentPrice") || xmlFind(item, "StartPrice");
  const price = priceStr ? parseFloat(priceStr) : null;
  const thumbnail = xmlFind(item, "GalleryURL") || null;
  const sku = xmlFind(item, "SKU") || null;
  const startTime = xmlFind(item, "StartTime") || null;
  const endTime = xmlFind(item, "EndTime") || null;
  return { listingId, title, price, thumbnail, sku, startTime, endTime, status };
}
