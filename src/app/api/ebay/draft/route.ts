import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { upsertInventoryItem, createOffer, getCategoryId, inventoryRequest } from "@/lib/ebay-inventory";

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

    const sku = draft.custom_sku || `listflow${draftId.replace(/-/g, "")}`;
    const categoryId = getCategoryId(draft.title || "");

    const itemResult = await upsertInventoryItem(sku, draft, categoryId);
    if (itemResult.status >= 400) {
      return NextResponse.json({ error: JSON.stringify(itemResult.data) }, { status: 400 });
    }

    let offerResult = await createOffer(sku, draft.suggested_price, categoryId, isHeavy ?? false);
    let offerId = (offerResult.data as { offerId?: string }).offerId;

    if (offerResult.status >= 400) {
      const errData = offerResult.data as { errors?: Array<{ errorId?: number; message?: string }> };
      const isAlreadyExists = errData.errors?.some((e) => e.errorId === 25002 || e.message?.toLowerCase().includes("already exists"));
      if (isAlreadyExists) {
        const existingResult = await inventoryRequest("GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`);
        const offers = (existingResult.data as { offers?: Array<{ offerId?: string }> }).offers;
        offerId = offers?.[0]?.offerId;
        if (!offerId) return NextResponse.json({ error: "Offer already exists but could not retrieve it" }, { status: 400 });
      } else {
        const msg = errData.errors?.[0]?.message ?? "Failed to create offer";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }
    return NextResponse.json({ success: true, offerId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
