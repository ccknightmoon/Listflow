import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getOfferBySku, deleteOffer, deleteInventoryItem, endItemByListingId } from "@/lib/ebay-inventory";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { draftId } = await req.json();
    if (!draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });

    const { data: draft } = await supabase
      .from("drafts")
      .select("id, custom_sku, ebay_listing_id")
      .eq("id", draftId)
      .single();

    if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

    const listingId = draft.ebay_listing_id as string | null;

    // Primary: end listing directly by listing ID via Trading API
    if (listingId) {
      const result = await endItemByListingId(listingId);
      // "Invalid item ID" / "Auction has already ended" are acceptable — listing is already gone
      const alreadyGone = !result.success && result.error &&
        (result.error.toLowerCase().includes("invalid item") ||
         result.error.toLowerCase().includes("already ended") ||
         result.error.toLowerCase().includes("cannot be ended"));
      if (!result.success && !alreadyGone) {
        return NextResponse.json(
          { error: `eBay delist failed: ${result.error}` },
          { status: 400 }
        );
      }
    }

    // Cleanup: delete any offers/inventory items across all SKU formats
    const hex = (draftId as string).replace(/-/g, "");
    const candidateSkus = [
      draft.custom_sku as string | null,
      String(parseInt(hex.slice(0, 8), 16) % 1000000),
      `listflow${hex.slice(0, 8)}`,
      `listflow${hex}`,
      `listflow-${draftId}`,
    ].filter((s): s is string => Boolean(s));

    for (const sku of candidateSkus) {
      const offerRes = await getOfferBySku(sku);
      const offers = (offerRes.data as { offers?: Array<{ offerId: string }> }).offers ?? [];
      for (const offer of offers) {
        await deleteOffer(offer.offerId);
      }
      await deleteInventoryItem(sku);
    }

    // Clear the listing ID so the draft moves back to Drafts
    await supabase.from("drafts").update({ ebay_listing_id: null }).eq("id", draftId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
