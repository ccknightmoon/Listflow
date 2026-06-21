import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tradingRequest } from "@/lib/ebay-inventory";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

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

export async function GET() {
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();

  const result = await tradingRequest(
    "GetSellerTransactions",
    `<?xml version="1.0" encoding="utf-8"?><GetSellerTransactionsRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ModTimeFrom>${from}</ModTimeFrom><ModTimeTo>${to}</ModTimeTo><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination></GetSellerTransactionsRequest>`
  );

  if (!result.body.includes("<Ack>Success</Ack>")) {
    const errMsg = xmlFind(result.body, "LongMessage") || xmlFind(result.body, "ShortMessage") || "eBay API error";
    const isAuth = errMsg.toLowerCase().includes("auth") || errMsg.toLowerCase().includes("token") || errMsg.toLowerCase().includes("permission");
    return NextResponse.json(
      { error: errMsg, items: [], count: 0, connect: !isAuth, reconnect: isAuth },
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
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  // Look up thumbnails from Supabase
  if (items.length > 0) {
    const listingIds = items.map((i) => i.listingId).filter(Boolean);
    const { data: drafts } = await supabase
      .from("drafts")
      .select("ebay_listing_id, thumbnail_url")
      .in("ebay_listing_id", listingIds);

    if (drafts?.length) {
      const thumbMap = new Map(drafts.map((d) => [d.ebay_listing_id as string, d.thumbnail_url as string | null]));
      for (const item of items) {
        item.thumbnail = thumbMap.get(item.listingId) ?? null;
      }
    }
  }

  return NextResponse.json({ items, count: items.length });
}
