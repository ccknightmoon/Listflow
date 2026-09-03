import { NextRequest, NextResponse } from "next/server";
import { getOfferBySku, deleteOffer, deleteInventoryItem, endItemByListingId, isValidEbayItemId } from "@/lib/ebay-inventory";
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
    const body = await req.json();
    const { draftId, listingId: directListingId } = body as { draftId?: string; listingId?: string };

    // Direct delist by listing ID — for items not tracked in Supabase
    if (directListingId && !draftId) {
      if (!isValidEbayItemId(directListingId)) {
        return NextResponse.json({ error: "Invalid eBay listing ID" }, { status: 400 });
      }
      const result = await endItemByListingId(directListingId);
      const alreadyGone = !result.success && (
        !result.error ||
        result.error.toLowerCase().includes("invalid item") ||
        result.error.toLowerCase().includes("already ended") ||
        result.error.toLowerCase().includes("cannot be ended") ||
        result.error.toLowerCase().includes("not found") ||
        result.error.toLowerCase().includes("does not exist")
      );
      if (!result.success && !alreadyGone) {
        return NextResponse.json({ error: `eBay delist failed: ${result.error || "(empty response)"}` }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    if (!draftId) return NextResponse.json({ error: "draftId or listingId required" }, { status: 400 });

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
      // Treat as already gone: empty response, invalid/not-found item, or already ended
      const alreadyGone = !result.success && (
        !result.error ||
        result.error.toLowerCase().includes("invalid item") ||
        result.error.toLowerCase().includes("already ended") ||
        result.error.toLowerCase().includes("cannot be ended") ||
        result.error.toLowerCase().includes("not found") ||
        result.error.toLowerCase().includes("does not exist")
      );
      if (!result.success && !alreadyGone) {
        return NextResponse.json(
          { error: `eBay delist failed: ${result.error || "(empty response)"}` },
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

    // Same independence as the equivalent cleanup in list/route.ts — each
    // candidate SKU's offers/inventory item are untouched by what happens to
    // the others, so there's no reason to clean them up one at a time.
    await Promise.all(candidateSkus.map(async (sku) => {
      const offerRes = await getOfferBySku(sku);
      const offers = (offerRes.data as { offers?: Array<{ offerId: string }> }).offers ?? [];
      await Promise.all(offers.map((offer) => deleteOffer(offer.offerId)));
      await deleteInventoryItem(sku);
    }));

    // Clear the listing ID so the draft moves back to Drafts
    await supabase.from("drafts").update({ ebay_listing_id: null }).eq("id", draftId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  });
}
