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

// Same limitation documented in /api/ebay/sales/route.ts: GetSellerTransactions'
// nested <Item> block never includes PictureDetails/GalleryURL no matter the
// DetailLevel, so a thumbnail for a paid-but-unshipped item can only come from
// this app's own Supabase record (if it was listed through this app) or a
// follow-up GetItem call per ItemID (for items listed manually on eBay, or
// listed before this app tracked photos). GetItem is only attempted for
// whatever's left after the Supabase pass.
function makeGetItemXml(itemId: string) {
  return `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${itemId}</ItemID><DetailLevel>ReturnAll</DetailLevel></GetItemRequest>`;
}

const EBAY_ITEM_ID_RE = /^\d{6,15}$/;
const GALLERY_LOOKUP_CONCURRENCY = 5;
// This page only ever shows paid-but-unshipped items (a small, naturally
// bounded list), but cap it anyway for the same reason sales/route.ts does -
// no unbounded number of eBay calls on one page load.
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

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase } = auth;

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ error: "eBay not connected.", items: [], count: 0, connect: true, reconnect: false }, { status: 200 });
  }

  return ebayContext.run(connection, async () => {
  try {

  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();

  const result = await tradingRequest(
    "GetSellerTransactions",
    `<?xml version="1.0" encoding="utf-8"?><GetSellerTransactionsRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DetailLevel>ReturnAll</DetailLevel><ModTimeFrom>${from}</ModTimeFrom><ModTimeTo>${to}</ModTimeTo><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination></GetSellerTransactionsRequest>`
  );

  if (!result.body.includes("<Ack>Success</Ack>")) {
    const errMsg = xmlFind(result.body, "LongMessage") || xmlFind(result.body, "ShortMessage") || "eBay API error";
    // "Not connected" is already checked up front via requireEbayConnection()
    // before this ever runs.
    const isAuth = errMsg.toLowerCase().includes("auth") || errMsg.toLowerCase().includes("token") || errMsg.toLowerCase().includes("permission");
    return NextResponse.json(
      { error: errMsg, items: [], count: 0, connect: false, reconnect: isAuth },
      { status: 200 }
    );
  }

  const txBlocks = xmlFindAll(result.body, "Transaction");

  const items = txBlocks
    .map((tx) => {
      const paidTime = xmlFind(tx, "PaidTime");
      const shippedTime = xmlFind(tx, "ShippedTime");

      // Only items that have been paid but not yet shipped
      if (!paidTime || shippedTime) return null;

      const itemBlock = xmlFind(tx, "Item");
      const listingId = xmlFind(itemBlock, "ItemID");
      const title = xmlFind(itemBlock, "Title") || xmlFind(tx, "Title");
      const transactionId = xmlFind(tx, "TransactionID");
      const price = parseFloat(xmlFind(tx, "TransactionPrice") || "0");
      const qty = parseInt(xmlFind(tx, "QuantityPurchased") || "1", 10);
      const pictureDetails = xmlFind(itemBlock, "PictureDetails");
      const galleryUrl = xmlFind(pictureDetails, "GalleryURL") || xmlFind(itemBlock, "GalleryURL") || null;

      const buyerBlock = xmlFind(tx, "Buyer");
      const buyerInfoBlock = xmlFind(buyerBlock, "BuyerInfo");
      const addrBlock = xmlFind(buyerInfoBlock, "ShippingAddress");

      const addrName = xmlFind(addrBlock, "Name");
      const street1 = xmlFind(addrBlock, "Street1");
      const street2 = xmlFind(addrBlock, "Street2");
      const city = xmlFind(addrBlock, "CityName");
      const state = xmlFind(addrBlock, "StateOrProvince");
      const zip = xmlFind(addrBlock, "PostalCode");

      const address = (city || state || zip)
        ? { name: addrName, street1, street2, city, state, zip }
        : null;

      return {
        listingId,
        transactionId,
        title,
        price,
        qty,
        total: price * qty,
        paidAt: paidTime,
        address,
        thumbnail: null as string | null,
        galleryUrl,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  // Look up thumbnails from Supabase first (instant, no extra eBay calls -
  // covers every item that was actually listed through this app).
  if (items.length > 0) {
    const listingIds = items.map((i) => i.listingId).filter(Boolean);
    const { data: drafts } = await supabase
      .from("drafts")
      .select("ebay_listing_id, thumbnail_url")
      .in("ebay_listing_id", listingIds);

    if (drafts?.length) {
      const thumbMap = new Map(drafts.map((d) => [d.ebay_listing_id as string, d.thumbnail_url as string | null]));
      for (const item of items) {
        item.thumbnail = thumbMap.get(item.listingId) ?? item.galleryUrl;
      }
    } else {
      for (const item of items) {
        item.thumbnail = item.galleryUrl;
      }
    }

    // Whatever's still missing a thumbnail (no Supabase record, and
    // GalleryURL essentially never comes back from GetSellerTransactions
    // itself - see fetchGalleryUrl's comment above) gets one GetItem call
    // each, a few at a time, so items listed manually on eBay (or listed
    // before this app tracked photos) still show a real photo instead of
    // the generic placeholder icon.
    const needsLookup = items.filter((i) => !i.thumbnail && i.listingId).slice(0, GALLERY_LOOKUP_MAX);
    if (needsLookup.length > 0) {
      const uniqueIds = [...new Set(needsLookup.map((i) => i.listingId))];
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
      for (const item of items) {
        if (!item.thumbnail) item.thumbnail = galleryMap.get(item.listingId) ?? null;
      }
    }
  }

  return NextResponse.json({ items, count: items.length });
  } catch (err) {
    console.error("[api/ebay/ship] failed:", err);
    return NextResponse.json({ error: (err as Error).message, items: [], count: 0 }, { status: 500 });
  }
  });
}
