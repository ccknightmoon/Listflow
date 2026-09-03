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

function xmlFindAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const results: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function makeSalesXml(from: string, to: string) {
  return `<?xml version="1.0" encoding="utf-8"?><GetSellerTransactionsRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DetailLevel>ReturnAll</DetailLevel><ModTimeFrom>${from}</ModTimeFrom><ModTimeTo>${to}</ModTimeTo><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination></GetSellerTransactionsRequest>`;
}

// GetSellerTransactions' nested <Item> block never includes PictureDetails/
// GalleryURL no matter the DetailLevel — confirmed against eBay's own docs,
// which list GetSellerTransactions' Item fields explicitly and say to use
// GetItem for anything beyond that limited set. So a gallery image for a
// sold item can only come from two places: this app's own Supabase record
// (if the item was listed through this app) or a follow-up GetItem call per
// ItemID (for older/manually-listed items with no Supabase row). GetItem is
// only attempted for whatever's left after the Supabase pass, since it's
// one extra round trip per item. Note: eBay stops returning item details
// (including pictures) for listings that ended more than ~90 days ago, so
// very old sales may still fall back to the placeholder icon — that's a
// real eBay limitation, not a bug here.
function makeGetItemXml(itemId: string) {
  return `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${itemId}</ItemID><DetailLevel>ReturnAll</DetailLevel></GetItemRequest>`;
}

const EBAY_ITEM_ID_RE = /^\d{6,15}$/;
const GALLERY_LOOKUP_CONCURRENCY = 5;
// Upper bound on how many GetItem calls one sales-page load will make —
// keeps a big 1-year window from turning into 100+ sequential eBay calls.
const GALLERY_LOOKUP_MAX = 60;

async function fetchGalleryUrl(itemId: string): Promise<string | null> {
  if (!EBAY_ITEM_ID_RE.test(itemId)) return null;
  try {
    const { body } = await tradingRequest("GetItem", makeGetItemXml(itemId));
    if (!body.includes("<Ack>Success</Ack>") && !body.includes("<Ack>Warning</Ack>")) {
      return null;
    }
    const pictureDetails = xmlFind(body, "PictureDetails");
    // Listings created through eBay's REST Inventory API (how this app
    // lists items) don't populate the classic single GalleryURL field on
    // GetItem's response — instead PictureDetails carries a list of
    // <PictureURL> entries. Confirmed against real production data: every
    // lookup that came up empty had a populated PictureURL list right next
    // to the missing GalleryURL. Try GalleryURL first (still correct for
    // older/manually-listed items that do use it), then fall back to the
    // first PictureURL.
    const gallery =
      xmlFind(pictureDetails, "GalleryURL") ||
      xmlFind(pictureDetails, "PictureURL") ||
      xmlFind(body, "GalleryURL") ||
      null;
    return gallery;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase } = auth;

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ error: "eBay not connected.", sales: [], connect: true, reconnect: false }, { status: 200 });
  }

  return ebayContext.run(connection, async () => {
  try {

  const { searchParams } = new URL(req.url);
  // Capped at 365 days (1 year) rather than eBay's per-call 30-day ModTime
  // limit — longer ranges are chunked into 30-day windows below and merged,
  // so "up to date" sold history means up to a year back, not just 90 days.
  const days = Math.min(parseInt(searchParams.get("days") ?? "30", 10), 365);

  // eBay caps ModTimeFrom/ModTimeTo at 30 days — split longer ranges into windows
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const windows: Array<{ from: string; to: string }> = [];
  let remaining = days;
  let windowEnd = now;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 30);
    const windowStart = windowEnd - chunk * MS_PER_DAY;
    windows.push({
      from: new Date(windowStart).toISOString(),
      to: new Date(windowEnd).toISOString(),
    });
    remaining -= chunk;
    windowEnd = windowStart;
  }

  const responses = await Promise.all(
    windows.map((w) => tradingRequest("GetSellerTransactions", makeSalesXml(w.from, w.to)))
  );

  // Report the first auth/connection error encountered
  for (const result of responses) {
    if (!result.body.includes("<Ack>Success</Ack>")) {
      const raw = xmlFind(result.body, "LongMessage") || xmlFind(result.body, "ShortMessage") || "eBay API error";
      const errMsg = decodeXml(decodeXml(raw));
      // "Not connected" is already checked up front via requireEbayConnection()
      // before this ever runs — an auth failure reaching here means a
      // revoked/expired token, not a never-connected account.
      const isAuth = errMsg.toLowerCase().includes("auth") || errMsg.toLowerCase().includes("token") || errMsg.toLowerCase().includes("permission");
      return NextResponse.json({ error: errMsg, sales: [], connect: false, reconnect: isAuth }, { status: 200 });
    }
  }

  // Merge transactions from all windows, dedup by TransactionID
  const seen = new Set<string>();
  const allTxBlocks: string[] = [];
  for (const result of responses) {
    for (const tx of xmlFindAll(result.body, "Transaction")) {
      const txId = xmlFind(tx, "TransactionID");
      const itemId = xmlFind(xmlFind(tx, "Item"), "ItemID");
      const key = `${itemId}-${txId}`;
      if (!seen.has(key)) {
        seen.add(key);
        allTxBlocks.push(tx);
      }
    }
  }

  const sales = allTxBlocks.map((tx) => {
    const itemBlock = xmlFind(tx, "Item");
    const title = xmlFind(itemBlock, "Title") || xmlFind(tx, "Title");
    const listingId = xmlFind(itemBlock, "ItemID");
    const price = parseFloat(xmlFind(tx, "TransactionPrice") || "0");
    const qty = parseInt(xmlFind(tx, "QuantityPurchased") || "1", 10);
    const soldAt = xmlFind(tx, "CreatedDate");
    return { listingId, title, price, qty, total: price * qty, soldAt, thumbnail: null as string | null };
  }).filter((s) => s.price > 0);

  // Most-recently-sold first. Transactions arrive merged from several
  // parallel 30-day-window calls (see the chunking above) in whatever
  // order Promise.all's results happen to land in, not chronological
  // order — without an explicit sort here the list on /sales came out
  // effectively shuffled relative to sale date. An unparseable/missing
  // soldAt sorts to the bottom rather than throwing the whole list off.
  sales.sort((a, b) => {
    const ta = Date.parse(a.soldAt);
    const tb = Date.parse(b.soldAt);
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    return tb - ta;
  });

  // Look up thumbnails from Supabase first (instant, no extra eBay calls —
  // covers every item that was actually listed through this app).
  if (sales.length > 0) {
    const listingIds = sales.map((s) => s.listingId).filter(Boolean);
    const { data: drafts } = await supabase
      .from("drafts")
      .select("ebay_listing_id, thumbnail_url")
      .in("ebay_listing_id", listingIds);

    if (drafts && drafts.length > 0) {
      const thumbMap = new Map(drafts.map((d) => [d.ebay_listing_id as string, d.thumbnail_url as string | null]));
      for (const sale of sales) {
        sale.thumbnail = thumbMap.get(sale.listingId) ?? null;
      }
    }

    // Whatever's still missing a thumbnail (no Supabase record, and
    // GalleryURL never comes back from GetSellerTransactions itself — see
    // fetchGalleryUrl's comment) gets one GetItem call each, a few at a
    // time, capped so a large date range can't turn into an unbounded
    // number of eBay calls on one page load.
    const needsLookup = sales.filter((s) => !s.thumbnail && s.listingId).slice(0, GALLERY_LOOKUP_MAX);
    if (needsLookup.length > 0) {
      const uniqueIds = [...new Set(needsLookup.map((s) => s.listingId))];
      const galleryMap = new Map<string, string | null>();
      let cursor = 0;
      async function worker() {
        while (cursor < uniqueIds.length) {
          const id = uniqueIds[cursor++];
          galleryMap.set(id, await fetchGalleryUrl(id));
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(GALLERY_LOOKUP_CONCURRENCY, uniqueIds.length) }, () => worker())
      );
      for (const sale of sales) {
        if (!sale.thumbnail) sale.thumbnail = galleryMap.get(sale.listingId) ?? null;
      }
    }
  }

  const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);

  return NextResponse.json({ sales, totalRevenue, days });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, sales: [] }, { status: 500 });
  }
  });
}
