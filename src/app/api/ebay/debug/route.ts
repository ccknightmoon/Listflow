import { NextRequest, NextResponse } from "next/server";
import {
  getAllOffers, getOfferBySku, getAllInventoryItems, inventoryRequest,
} from "@/lib/ebay-inventory";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sku = searchParams.get("sku") ?? "";
  const categoryId = searchParams.get("cat") ?? "15687";

  const [allOffersRes, skuOfferRes, allItemsRes, categoryAspectsRes, conditionPoliciesRes] = await Promise.all([
    getAllOffers(),
    sku ? getOfferBySku(sku) : Promise.resolve({ status: 0, data: { skipped: true } }),
    getAllInventoryItems(),
    inventoryRequest("GET", `/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${categoryId}`),
    // Correct endpoint for condition policies (not get_categories_as_aspects_for_listing)
    inventoryRequest("GET", `/sell/metadata/v1/marketplace/EBAY_US/get_listing_policies?filter=conditionPolicies&category_ids=${categoryId}`),
  ]);

  return NextResponse.json({
    categoryId, sku,
    allOffers: allOffersRes.data,
    skuOffer: skuOfferRes.data,
    allInventoryItems: allItemsRes.data,
    conditionPolicies: conditionPoliciesRes.data,
    categoryAspects_firstFew: (() => {
      const aspects = (categoryAspectsRes.data as { aspects?: unknown[] }).aspects;
      return Array.isArray(aspects) ? aspects.slice(0, 3) : categoryAspectsRes.data;
    })(),
  }, { status: 200 });
}
