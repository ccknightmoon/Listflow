import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  upsertInventoryItem, createOffer, updateOffer, getOfferBySku, getAllOffers,
  publishOffer, getCategoryId, ensureMerchantLocation, recreateMerchantLocation,
} from "@/lib/ebay-inventory";

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
    const heavy = isHeavy ?? false;

    await ensureMerchantLocation();

    const itemResult = await upsertInventoryItem(sku, draft, categoryId);
    if (itemResult.status >= 400) {
      const errData = itemResult.data as { errors?: Array<{ longMessage?: string; message?: string }>; message?: string };
      const msg = errData.errors?.[0]?.longMessage ?? errData.errors?.[0]?.message ?? errData.message ?? JSON.stringify(itemResult.data);
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    let offerId: string | undefined;
    const offerResult = await createOffer(sku, draft.suggested_price, categoryId, heavy);
    offerId = (offerResult.data as { offerId?: string }).offerId;

    if (offerResult.status >= 400) {
      const errData = offerResult.data as { errors?: Array<{ errorId?: number; message?: string; longMessage?: string }> };
      const err0 = errData.errors?.[0];
      const msg = (err0?.message ?? "").toLowerCase();

      if (msg.includes("already exists")) {
        // Offer already exists — find it by trying both SKU formats, then scanning all offers
        const skusToTry = [sku, `listflow-${draftId}`];
        for (const candidateSku of skusToTry) {
          const res = await getOfferBySku(candidateSku);
          const offers = (res.data as { offers?: Array<{ offerId: string }> }).offers;
          offerId = offers?.[0]?.offerId;
          if (offerId) break;
        }
        if (!offerId) {
          const allRes = await getAllOffers();
          const allOffers = (allRes.data as { offers?: Array<{ offerId: string; sku?: string }> }).offers ?? [];
          offerId = allOffers.find(o => skusToTry.includes(o.sku ?? ""))?.offerId;
        }
        if (!offerId) {
          return NextResponse.json({ error: "Offer already exists but could not be retrieved. Please contact eBay support." }, { status: 500 });
        }
        // Update the recovered offer with current price and merchant location
        await updateOffer(offerId, draft.suggested_price, categoryId, heavy);

      } else if (msg.includes("location")) {
        // Merchant location not found — recreate it and retry once
        await recreateMerchantLocation();
        const retryResult = await createOffer(sku, draft.suggested_price, categoryId, heavy);
        offerId = (retryResult.data as { offerId?: string }).offerId;
        if (retryResult.status >= 400 || !offerId) {
          const retryErr = (retryResult.data as { errors?: Array<{ message?: string }> }).errors?.[0];
          return NextResponse.json({ error: `Location fix failed: ${retryErr?.message ?? JSON.stringify(retryResult.data)}` }, { status: 400 });
        }

      } else {
        const errMsg = err0?.longMessage ?? err0?.message ?? "Failed to create offer";
        return NextResponse.json({ error: errMsg }, { status: 400 });
      }
    }

    if (!offerId) return NextResponse.json({ error: "No offer ID returned" }, { status: 500 });

    const publishResult = await publishOffer(offerId);
    if (publishResult.status >= 400) {
      const errData = publishResult.data as { errors?: Array<{ message?: string; longMessage?: string }> };
      const errMsg = errData.errors?.[0]?.longMessage ?? errData.errors?.[0]?.message ?? "Failed to publish listing";
      return NextResponse.json({ error: errMsg }, { status: 400 });
    }

    const listingId = (publishResult.data as { listingId?: string }).listingId;
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
