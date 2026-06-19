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
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const [draftsResult, activeResult, salesResult] = await Promise.allSettled([
    // 1. Draft count from Supabase
    supabase
      .from("drafts")
      .select("id", { count: "exact", head: true })
      .is("ebay_listing_id", null),

    // 2. Active listing count from eBay
    tradingRequest(
      "GetMyeBaySelling",
      `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Pagination><EntriesPerPage>1</EntriesPerPage><PageNumber>1</PageNumber></Pagination></ActiveList></GetMyeBaySellingRequest>`
    ),

    // 3. Sales this week from eBay
    tradingRequest(
      "GetSellerTransactions",
      `<?xml version="1.0" encoding="utf-8"?><GetSellerTransactionsRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ModTimeFrom>${sevenDaysAgo}</ModTimeFrom><ModTimeTo>${now}</ModTimeTo><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination></GetSellerTransactionsRequest>`
    ),
  ]);

  // Draft count
  let drafts = 0;
  if (draftsResult.status === "fulfilled" && draftsResult.value.count != null) {
    drafts = draftsResult.value.count;
  }

  // Active listing count
  let active = 0;
  if (activeResult.status === "fulfilled") {
    const totalStr = xmlFind(activeResult.value.body, "TotalNumberOfEntries");
    active = totalStr ? parseInt(totalStr, 10) : 0;
  }

  // Weekly revenue: sum TransactionPrice * QuantityPurchased for each sold transaction
  let weeklyRevenue = 0;
  if (salesResult.status === "fulfilled" && salesResult.value.body.includes("<Ack>Success</Ack>")) {
    const txBlocks = xmlFindAll(salesResult.value.body, "Transaction");
    for (const tx of txBlocks) {
      const priceStr = xmlFind(tx, "TransactionPrice");
      const qtyStr = xmlFind(tx, "QuantityPurchased");
      const price = parseFloat(priceStr || "0");
      const qty = parseInt(qtyStr || "1", 10);
      if (price > 0) weeklyRevenue += price * qty;
    }
  }

  return NextResponse.json({ drafts, active, weeklyRevenue });
}
