import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tradingRequest } from "@/lib/ebay-inventory";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { listingId, price, draftId } = await req.json();
    if (!listingId || !price) return NextResponse.json({ error: "listingId and price required" }, { status: 400 });

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
}
