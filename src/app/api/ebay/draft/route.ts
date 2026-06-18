import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { upsertInventoryItem, createOffer, getCategoryId } from "@/lib/ebay-inventory";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { draftId, isHeavy } = await req.json();
    if (!draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });

    const { data: draft, error: dbError } = await supabase
      .from("drafts")
      .select("*")
      .eq("id", draftId)
      .single();

    if (dbError || !draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    if (!draft.suggested_price) return NextResponse.json({ error: "Set a price before saving to eBay" }, { status: 400 });

    const sku = `listflow-${draftId}`;
    const categoryId = getCategoryId(draft.title || "");

    const itemResult = await upsertInventoryItem(sku, draft, categoryId);
    if (itemResult.status >= 400) {
      return NextResponse.json({ error: JSON.stringify(itemResult.data) }, { status: 400 });
    }

    const offerResult = await createOffer(sku, draft.suggested_price, categoryId, isHeavy ?? false);
    if (offerResult.status >= 400) {
      const errData = offerResult.data as { errors?: Array<{ message?: string; longMessage?: string }> };
      const msg = errData.errors?.[0]?.longMessage ?? errData.errors?.[0]?.message ?? "Failed to create offer";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const offerId = (offerResult.data as { offerId?: string }).offerId;
    return NextResponse.json({ success: true, offerId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
