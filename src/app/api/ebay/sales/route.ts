import { NextResponse } from "next/server";
import { tradingRequest } from "@/lib/ebay-inventory";

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
    return NextResponse.json({ error: errMsg, sales: [] }, { status: 200 });
  }

  const txBlocks = xmlFindAll(result.body, "Transaction");

  const sales = txBlocks.map((tx) => {
    const itemBlock = xmlFind(tx, "Item");
    const title = xmlFind(itemBlock, "Title") || xmlFind(tx, "Title");
    const listingId = xmlFind(itemBlock, "ItemID");
    const thumbnail = xmlFind(itemBlock, "PictureDetails")
      ? xmlFind(xmlFind(itemBlock, "PictureDetails"), "GalleryURL")
      : null;
    const price = parseFloat(xmlFind(tx, "TransactionPrice") || "0");
    const qty = parseInt(xmlFind(tx, "QuantityPurchased") || "1", 10);
    const soldAt = xmlFind(tx, "CreatedDate");

    return { listingId, title, price, qty, total: price * qty, soldAt, thumbnail };
  }).filter((s) => s.price > 0);

  const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);

  return NextResponse.json({ sales, totalRevenue, days });
}
