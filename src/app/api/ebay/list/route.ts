import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { upsertInventoryItem, createOffer, publishOffer, getCategoryId } from "@/lib/ebay-inventory";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { draftId, isHeavy } = await req.json();
    if (!draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });

    if (!process.env.EBAY_OAUTH_REFRESH_TOKEN) {
      return NextResponse.json({ error: "eBay not connected — go to /api/ebay/connect to authorize" }, { status: 400 });
    }

    const { data: draft, error: dbError } = await supabase
      .from("drafts")
      .select("*")
      .eq("id", draftId)
      .single();

    if (dbError || !draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    if (!draft.suggested_price) return NextResponse.json({ error: "Set a price before listing" }, { status: 400 });

    const sku = draft.custom_sku || `listflow${draftId.replace(/-/g, "")}`;
    const categoryId = getCategoryId(draft.title || "");

    const itemResult = await upsertInventoryItem(sku, draft, categoryId);
    if (itemResult.status >= 400) {
      const errData = itemResult.data as { errors?: Array<{ longMessage?: string; message?: string }>; message?: string };
      const msg = errData.errors?.[0]?.longMessage ?? errData.errors?.[0]?.message ?? errData.message ?? JSON.stringify(itemResult.data);
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const offerResult = await createOffer(sku, draft.suggested_price, categoryId, isHeavy ?? false);
    if (offerResult.status >= 400) {
      const errData = offerResult.data as { errors?: Array<{ message?: string; longMessage?: string }> };
      const msg = errData.errors?.[0]?.longMessage ?? errData.errors?.[0]?.message ?? "Failed to create offer";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const offerId = (offerResult.data as { offerId?: string }).offerId;
    if (!offerId) return NextResponse.json({ error: "No offer ID returned" }, { status: 500 });

    const publishResult = await publishOffer(offerId);
    if (publishResult.status >= 400) {
      const errData = publishResult.data as { errors?: Array<{ message?: string; longMessage?: string }> };
      const msg = errData.errors?.[0]?.longMessage ?? errData.errors?.[0]?.message ?? "Failed to publish listing";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const listingId = (publishResult.data as { listingId?: string }).listingId;

    // Save listing ID back to draft so we can show Live status
    if (listingId) {
      await supabase.from("drafts").update({ ebay_listing_id: listingId }).eq("id", draftId);
    }

    return NextResponse.json({
      success: true,
      listingId,
      url: `https://www.ebay.com/itm/${listingId}`,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
