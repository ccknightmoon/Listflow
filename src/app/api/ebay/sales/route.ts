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

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function makeSalesXml(from: string, to: string) {
  return `<?xml version="1.0" encoding="utf-8"?><GetSellerTransactionsRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ModTimeFrom>${from}</ModTimeFrom><ModTimeTo>${to}</ModTimeTo><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination></GetSellerTransactionsRequest>`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(parseInt(searchParams.get("days") ?? "30", 10), 90);

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
      const notConnected = !process.env.EBAY_OAUTH_REFRESH_TOKEN;
      const isAuth = !notConnected && (errMsg.toLowerCase().includes("auth") || errMsg.toLowerCase().includes("token") || errMsg.toLowerCase().includes("permission"));
      return NextResponse.json({ error: errMsg, sales: [], connect: notConnected, reconnect: isAuth }, { status: 200 });
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
    const pictureDetails = xmlFind(itemBlock, "PictureDetails");
    const galleryUrl = xmlFind(pictureDetails, "GalleryURL") || xmlFind(itemBlock, "GalleryURL") || null;
    return { listingId, title, price, qty, total: price * qty, soldAt, thumbnail: null as string | null, galleryUrl };
  }).filter((s) => s.price > 0);

  // Look up thumbnails from Supabase; fall back to eBay gallery image
  if (sales.length > 0) {
    const listingIds = sales.map((s) => s.listingId).filter(Boolean);
    const { data: drafts } = await supabase
      .from("drafts")
      .select("ebay_listing_id, thumbnail_url")
      .in("ebay_listing_id", listingIds);

    if (drafts && drafts.length > 0) {
      const thumbMap = new Map(drafts.map((d) => [d.ebay_listing_id as string, d.thumbnail_url as string | null]));
      for (const sale of sales) {
        sale.thumbnail = thumbMap.get(sale.listingId) ?? sale.galleryUrl;
      }
    } else {
      for (const sale of sales) {
        sale.thumbnail = sale.galleryUrl;
      }
    }
  }

  const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);

  return NextResponse.json({ sales, totalRevenue, days });
}
