import { NextResponse } from "next/server";
import { tradingRequest } from "@/lib/ebay-inventory";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";

export const runtime = "nodejs";

function xmlFind(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m?.[1]?.trim() ?? "";
}

function extractItemBlocks(xml: string): string[] {
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

type ListType = "ActiveList" | "UnsoldList";

async function fetchListPage(listType: ListType, page: number) {
  return tradingRequest(
    "GetMyeBaySelling",
    `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><${listType}><Include>true</Include><Pagination><EntriesPerPage>${ENTRIES_PER_PAGE}</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></${listType}><DetailLevel>ReturnSummary</DetailLevel></GetMyeBaySellingRequest>`
  );
}

interface ListTypeError {
  error: string;
  connect: boolean;
  reconnect: boolean;
}

function isListTypeError(r: unknown): r is ListTypeError {
  return typeof r === "object" && r !== null && "error" in r;
}

// Fetches every page of one list type (Active or Unsold) — same pagination
// pattern used for both, so accounts with >200 listings of either kind don't
// silently lose everything past page 1. UnsoldList = listings that ended
// without selling (eBay only retains a recent window of these, not full
// history — there's no way to widen that from our side).
async function fetchAllOfListType(listType: ListType): Promise<{ items: string[]; total: number } | ListTypeError> {
  const { status, body } = await fetchListPage(listType, 1);

  if (status >= 400) {
    return { error: `Trading API HTTP ${status}: ${body.slice(0, 300)}`, connect: false, reconnect: false };
  }
  if (body.includes("<Ack>Failure</Ack>")) {
    const errMsg =
      body.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1] ??
      body.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/)?.[1] ??
      body.slice(0, 300);
    // "Not connected" is now checked up front in GET() via
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

function toListing(item: string, status: "active" | "ended") {
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

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ error: "eBay not connected.", connect: true }, { status: 502 });
  }

  return ebayContext.run(connection, async () => {
  try {
    const [activeResult, unsoldResult] = await Promise.all([
      fetchAllOfListType("ActiveList"),
      fetchAllOfListType("UnsoldList"),
    ]);

    // Active listings are the ones people depend on day to day — surface a
    // hard error if that call fails. If only Unsold fails, don't block the
    // whole page over it; just report zero ended listings.
    if (isListTypeError(activeResult)) {
      return NextResponse.json(activeResult, { status: 502 });
    }

    const activeListings = activeResult.items.map((item) => toListing(item, "active"));
    const unsoldListings = isListTypeError(unsoldResult) ? [] : unsoldResult.items.map((item) => toListing(item, "ended"));

    return NextResponse.json({
      listings: [...activeListings, ...unsoldListings],
      activeTotal: activeResult.total,
      unsoldTotal: isListTypeError(unsoldResult) ? 0 : unsoldResult.total,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  });
}
