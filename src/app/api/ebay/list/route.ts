import { NextRequest, NextResponse } from "next/server";
import {
  upsertInventoryItem, createOffer, updateOffer, deleteOffer, deleteInventoryItem,
  getOfferBySku, getAllOffers, publishOffer, getCategoryIdForTitle, getSafeFallbackCategory,
  ensureMerchantLocation, recreateMerchantLocation, CONDITION_MAP,
} from "@/lib/ebay-inventory";
import { invalidateAccessTokenCache } from "@/lib/ebay-oauth";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase } = auth;

  try {
    const { draftId, isHeavy, shippingCost: rawShippingCost, customSku: requestCustomSku } = await req.json();
    const shippingCost = typeof rawShippingCost === "number" && rawShippingCost > 0 ? rawShippingCost : undefined;
    if (!draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });

    if (!process.env.EBAY_OAUTH_REFRESH_TOKEN) {
      return NextResponse.json({ error: "eBay not connected. Authorize your account to start listing.", connect: true }, { status: 400 });
    }

    const { data: draft, error: dbError } = await supabase
      .from("drafts")
      .select("*")
      .eq("id", draftId)
      .single();

    if (dbError || !draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    if (!draft.suggested_price) return NextResponse.json({ error: "Set a price before listing" }, { status: 400 });

    // Auto-assign next sequential SKU if none set. NOTE: this read-then-write
    // is still not fully race-proof under truly concurrent "list all" clicks —
    // a DB-level unique constraint on custom_sku (added in the RLS migration)
    // means a genuine collision now fails loudly instead of silently
    // double-assigning, but it isn't retried automatically here.
    let assignedSku = requestCustomSku || (draft.custom_sku as string | null);
    if (!assignedSku) {
      const { data: maxRow } = await supabase
        .from("drafts")
        .select("custom_sku")
        .not("custom_sku", "is", null)
        .order("custom_sku", { ascending: false })
        .limit(50);
      const maxNum = (maxRow ?? [])
        .map((r) => parseInt(r.custom_sku as string, 10))
        .filter((n) => !isNaN(n))
        .reduce((max, n) => (n > max ? n : max), 0);
      assignedSku = String(maxNum + 1);
      // Save it so it's visible on the draft
      await supabase.from("drafts").update({ custom_sku: assignedSku }).eq("id", draftId);
    }
    const autoSku = String(parseInt(draftId.replace(/-/g, "").slice(0, 8), 16) % 1000000);
    const sku = assignedSku;
    // Legacy SKU formats used before the numeric format was introduced
    const legacyFullSku = `listflow${draftId.replace(/-/g, "")}`;
    const legacyShortSku = `listflow${draftId.replace(/-/g, "").slice(0, 8)}`;
    const legacyHyphenSku = `listflow-${draftId}`;
    const categoryId = await getCategoryIdForTitle(draft.title || "", draft.item_type || undefined);
    const heavy = isHeavy ?? false;

    await ensureMerchantLocation();

    // Purge all stale offers and the inventory item before recreating.
    // eBay blocks condition changes on inventory items with prior offers — deleting everything
    // gives us a guaranteed clean slate with the correct condition and category.
    // Always include autoSku so that switching from auto→custom SKU cleans up the old auto entry
    const skusToClean = [...new Set([sku, autoSku, legacyFullSku, legacyShortSku, legacyHyphenSku])];
    for (const candidateSku of skusToClean) {
      const existingRes = await getOfferBySku(candidateSku);
      const existingOffers = (existingRes.data as { offers?: Array<{ offerId: string }> }).offers ?? [];
      for (const existing of existingOffers) {
        await deleteOffer(existing.offerId);
      }
      await deleteInventoryItem(candidateSku);
    }

    const itemResult = await upsertInventoryItem(sku, draft, categoryId);
    if (itemResult.status >= 400) {
      const errData = itemResult.data as { errors?: Array<{ longMessage?: string; message?: string }>; message?: string };
      const msg = errData.errors?.[0]?.longMessage ?? errData.errors?.[0]?.message ?? errData.message ?? JSON.stringify(itemResult.data);
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    // eBay-required fields for this category that the AI/draft data didn't
    // cover — surfaced so the frontend can warn the seller before they treat
    // this listing as "auto-filled and done." A successful publish below
    // means eBay accepted the listing without these, but they may still be
    // worth filling in for search visibility.
    let missingRequiredAspects = itemResult.missingRequiredAspects ?? [];

    let offerId: string | undefined;
    const offerResult = await createOffer(sku, draft.suggested_price, categoryId, heavy, shippingCost);
    offerId = (offerResult.data as { offerId?: string }).offerId;

    if (offerResult.status >= 400) {
      const errData = offerResult.data as { errors?: Array<{ errorId?: number; message?: string; longMessage?: string }> };
      const err0 = errData.errors?.[0];
      const msg = (err0?.message ?? "").toLowerCase();

      if (msg.includes("already exists")) {
        // Offer already exists — find it by trying both SKU formats, then scanning all offers
        const skusToTry = [sku, `listflow-${draftId}`];
        let foundViaSku: string | undefined;
        for (const candidateSku of skusToTry) {
          const res = await getOfferBySku(candidateSku);
          const offers = (res.data as { offers?: Array<{ offerId: string }> }).offers;
          offerId = offers?.[0]?.offerId;
          if (offerId) { foundViaSku = candidateSku; break; }
        }
        if (!offerId) {
          const allRes = await getAllOffers();
          const allOffers = (allRes.data as { offers?: Array<{ offerId: string; sku?: string }> }).offers ?? [];
          const match = allOffers.find(o => skusToTry.includes(o.sku ?? ""));
          offerId = match?.offerId;
          foundViaSku = match?.sku;
        }
        if (!offerId) {
          return NextResponse.json({ error: "Offer already exists but could not be retrieved. Please contact eBay support." }, { status: 500 });
        }
        if (foundViaSku && foundViaSku !== sku) {
          // Old-SKU offer: delete it so we can create a fresh one linked to the current inventory item
          await deleteOffer(offerId);
          const freshResult = await createOffer(sku, draft.suggested_price, categoryId, heavy, shippingCost);
          offerId = (freshResult.data as { offerId?: string }).offerId;
          if (freshResult.status >= 400 || !offerId) {
            const e = (freshResult.data as { errors?: Array<{ message?: string }> }).errors?.[0];
            return NextResponse.json({ error: e?.message ?? "Failed to create offer after deleting old one" }, { status: 400 });
          }
        } else {
          // Same-SKU offer: update price, category, and merchant location
          await updateOffer(offerId, draft.suggested_price, categoryId, heavy, shippingCost);
        }

      } else if (msg.includes("location")) {
        // Merchant location not found — recreate it and retry once
        await recreateMerchantLocation();
        const retryResult = await createOffer(sku, draft.suggested_price, categoryId, heavy, shippingCost);
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

    // Brief pause so eBay's inventory service indexes the item before publishing
    await new Promise((r) => setTimeout(r, 1500));
    let publishResult = await publishOffer(offerId);
    if (publishResult.status >= 400) {
      const publishErr = (publishResult.data as { errors?: Array<{ message?: string; longMessage?: string }> }).errors?.[0];
      const errMsg = publishErr?.longMessage ?? publishErr?.message ?? "";

      const errLower = errMsg.toLowerCase();
      const needsCategoryFallback =
        errLower.includes("condition") ||
        errLower.includes("item specific") ||
        errLower.includes("missing") ||
        errLower.includes("inseam") ||
        errLower.includes("required") ||
        errLower.includes("not found") ||
        errLower.includes("product not found") ||
        errLower.includes("cannot publish");

      if (needsCategoryFallback) {
        // categoryId is immutable on an existing offer — delete and recreate with safe clothing category.
        // Also handles "item specific missing" errors caused by wrong taxonomy category (e.g. shirt → pants).
        await deleteOffer(offerId);
        // Wait for eBay to process the deletion before creating a new offer
        await new Promise((r) => setTimeout(r, 2000));
        const safeCategory = getSafeFallbackCategory(draft.title || "");
        const originalCondition = CONDITION_MAP[draft.condition ?? ""] ?? "USED_GOOD";
        // Only ever retry with the item's OWN actual condition — never widen
        // to a worse one. This used to fall back to "USED_EXCELLENT" for
        // brand-new items just to force a listing through, which meant a
        // live eBay listing could silently claim a "New with tags" item was
        // actually used. A wrong condition on a public listing is an
        // "item not as described" risk, not a cosmetic bug, so if retrying
        // with the item's real condition still fails, we report the error
        // instead of trying to relabel it.
        const conditionsToTry = originalCondition === "USED_ACCEPTABLE"
          ? ["USED_ACCEPTABLE", "USED_GOOD"]
          : [originalCondition];

        for (const tryCondition of conditionsToTry) {
          const upsertResult = await upsertInventoryItem(sku, draft, safeCategory, tryCondition);
          if (upsertResult.status >= 400) continue;
          missingRequiredAspects = upsertResult.missingRequiredAspects ?? missingRequiredAspects;
          // Brief pause so eBay's inventory service indexes the item before we try to publish
          await new Promise((r) => setTimeout(r, 1500));
          const freshOffer = await createOffer(sku, draft.suggested_price, safeCategory, heavy, shippingCost);
          const freshOfferId = (freshOffer.data as { offerId?: string }).offerId;
          if (freshOffer.status >= 400 || !freshOfferId) continue;
          publishResult = await publishOffer(freshOfferId);
          offerId = freshOfferId;
          if (publishResult.status < 400) break;
          await deleteOffer(freshOfferId);
        }
      }

      if (publishResult.status >= 400) {
        const retryErr = (publishResult.data as { errors?: Array<{ message?: string; longMessage?: string }> }).errors?.[0];
        const initialCat = categoryId;
        const safecat = getSafeFallbackCategory(draft.title || "");
        return NextResponse.json({ error: `${retryErr?.longMessage ?? retryErr?.message ?? "Failed to publish listing"} [initial cat:${initialCat}, safe cat:${safecat}]` }, { status: 400 });
      }
    }

    const rawListingId = (publishResult.data as { listingId?: string | number }).listingId;
    const listingId = rawListingId != null ? String(rawListingId) : undefined;
    if (listingId) {
      await supabase.from("drafts").update({ ebay_listing_id: listingId }).eq("id", draftId);
    }

    return NextResponse.json({
      success: true,
      listingId,
      url: listingId ? `https://www.ebay.com/itm/${listingId}` : null,
      missingRequiredAspects: missingRequiredAspects.length > 0 ? missingRequiredAspects : undefined,
    });
  } catch (err) {
    const msg = (err as Error).message ?? "";
    const isTokenExpired = msg.toLowerCase().includes("invalid_grant") ||
      msg.toLowerCase().includes("token expired") ||
      msg.toLowerCase().includes("invalid access token") ||
      msg.toLowerCase().includes("oauth");
    if (isTokenExpired) {
      // Force the next attempt to fetch a fresh token instead of reusing
      // the cached one that just failed.
      invalidateAccessTokenCache();
      return NextResponse.json({ error: "eBay token expired. Reconnect eBay to continue listing.", reconnect: true }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
