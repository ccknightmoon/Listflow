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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(parseInt(searchParams.get("days") ?? "30", 10), 90);

  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();

  const result = await tradingRequest(
    "GetSellerTransactions",
    `<?xml version="1.0" encoding="utf-8"?><GetSellerTransactionsRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ModTimeFrom>${from}</ModTimeFrom><ModTimeTo>${to}</ModTimeTo><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination></GetSellerTransactionsRequest>`
  );

  if (!result.body.includes("<Ack>Success</Ack>")) {
    const errMsg = xmlFind(result.body, "LongMessage") || xmlFind(result.body, "ShortMessage") || "eBay API error";
    const notConnected = !process.env.EBAY_OAUTH_REFRESH_TOKEN;
    const isAuth = !notConnected && (errMsg.toLowerCase().includes("auth") || errMsg.toLowerCase().includes("token") || errMsg.toLowerCase().includes("permission"));
    return NextResponse.json({ error: errMsg, sales: [], connect: notConnected, reconnect: isAuth }, { status: 200 });
  }

  const txBlocks = xmlFindAll(result.body, "Transaction");

  const sales = txBlocks.map((tx) => {
    const itemBlock = xmlFind(tx, "Item");
    const title = xmlFind(itemBlock, "Title") || xmlFind(tx, "Title");
    const listingId = xmlFind(itemBlock, "ItemID");
    const price = parseFloat(xmlFind(tx, "TransactionPrice") || "0");
    const qty = parseInt(xmlFind(tx, "QuantityPurchased") || "1", 10);
    const soldAt = xmlFind(tx, "CreatedDate");
    return { listingId, title, price, qty, total: price * qty, soldAt, thumbnail: null as string | null };
  }).filter((s) => s.price > 0);

  // Look up thumbnails from Supabase for items listed through Listflow
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
  }

  const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);

  return NextResponse.json({ sales, totalRevenue, days });
}
