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

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase } = auth;

  // Draft count is Supabase-only, unrelated to any eBay connection.
  const draftsResult = await supabase
    .from("drafts")
    .select("id", { count: "exact", head: true })
    .is("ebay_listing_id", null);

  let drafts: number | null = null;
  if (draftsResult.count != null) {
    drafts = draftsResult.count;
  }

  // Phase 2: every eBay call needs a per-request connection context (see
  // ebay-request-context.ts) - this route used to call tradingRequest()
  // directly with no requireEbayConnection()/ebayContext.run() wrapper,
  // which meant getAccessToken() always threw "no active eBay context"
  // and active/weeklyRevenue/weeklySales silently fell back to a false 0
  // instead of ever reflecting real eBay data, connected or not.
  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ drafts, active: null, weeklyRevenue: null, weeklySales: null });
  }

  return ebayContext.run(connection, async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const [activeResult, salesResult] = await Promise.allSettled([
      // Active listing count from eBay
      tradingRequest(
        "GetMyeBaySelling",
        `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Pagination><EntriesPerPage>1</EntriesPerPage><PageNumber>1</PageNumber></Pagination></ActiveList></GetMyeBaySellingRequest>`
      ),
      // Sales this week from eBay
      tradingRequest(
        "GetSellerTransactions",
        `<?xml version="1.0" encoding="utf-8"?><GetSellerTransactionsRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ModTimeFrom>${sevenDaysAgo}</ModTimeFrom><ModTimeTo>${now}</ModTimeTo><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination></GetSellerTransactionsRequest>`
      ),
    ]);

    // Active listing count - null (not 0) unless eBay actually confirmed
    // success, so a token/API failure shows "-" instead of a false zero.
    let active: number | null = null;
    if (activeResult.status === "fulfilled" && activeResult.value.body.includes("<Ack>Success</Ack>")) {
      const totalStr = xmlFind(activeResult.value.body, "TotalNumberOfEntries");
      active = totalStr ? parseInt(totalStr, 10) : 0;
    }

    // Weekly revenue + sale count - same honesty rule.
    let weeklyRevenue: number | null = null;
    let weeklySales: number | null = null;
    if (salesResult.status === "fulfilled" && salesResult.value.body.includes("<Ack>Success</Ack>")) {
      weeklyRevenue = 0;
      weeklySales = 0;
      const txBlocks = xmlFindAll(salesResult.value.body, "Transaction");
      for (const tx of txBlocks) {
        const priceStr = xmlFind(tx, "TransactionPrice");
        const qtyStr = xmlFind(tx, "QuantityPurchased");
        const price = parseFloat(priceStr || "0");
        const qty = parseInt(qtyStr || "1", 10);
        if (price > 0) { weeklyRevenue += price * qty; weeklySales += qty; }
      }
    }

    return NextResponse.json({ drafts, active, weeklyRevenue, weeklySales });
  });
}
