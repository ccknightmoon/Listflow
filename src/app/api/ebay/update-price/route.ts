import { NextRequest, NextResponse } from "next/server";
import { tradingRequest, isValidEbayItemId } from "@/lib/ebay-inventory";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase } = auth;

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ error: "eBay not connected. Authorize your account first.", connect: true }, { status: 400 });
  }

  return ebayContext.run(connection, async () => {
  try {
    const { listingId, price, draftId } = await req.json();
    if (!listingId || !price) return NextResponse.json({ error: "listingId and price required" }, { status: 400 });
    if (!isValidEbayItemId(String(listingId))) {
      return NextResponse.json({ error: "Invalid eBay listing ID" }, { status: 400 });
    }

    const numPrice = parseFloat(price);
    if (isNaN(numPrice) || numPrice <= 0) return NextResponse.json({ error: "Invalid price" }, { status: 400 });

    const result = await tradingRequest(
      "ReviseFixedPriceItem",
      `<?xml version="1.0" encoding="utf-8"?><ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><Item><ItemID>${listingId}</ItemID><StartPrice>${numPrice.toFixed(2)}</StartPrice></Item></ReviseFixedPriceItemRequest>`
    );

    if (!result.body.includes("<Ack>Success</Ack>") && !result.body.includes("<Ack>Warning</Ack>")) {
      const errMsg = result.body.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1]?.trim()
        || result.body.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/)?.[1]?.trim()
        || "eBay update failed";
      return NextResponse.json({ error: errMsg }, { status: 400 });
    }

    // Keep Supabase in sync for Listflow items
    if (draftId) {
      await supabase.from("drafts").update({ suggested_price: numPrice }).eq("id", draftId);
    }

    return NextResponse.json({ success: true, price: numPrice });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  });
}
