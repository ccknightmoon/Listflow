import { NextRequest, NextResponse } from "next/server";
import {
  getAllOffers, getOfferBySku, inventoryRequest,
} from "@/lib/ebay-inventory";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sku = searchParams.get("sku") ?? "";
  const categoryId = searchParams.get("cat") ?? "15687";

  const [allOffersRes, skuOfferRes, categoryAspectsRes, conditionPoliciesRes] = await Promise.all([
    getAllOffers(),
    sku ? getOfferBySku(sku) : Promise.resolve({ status: 0, data: { skipped: true } }),
    inventoryRequest("GET", `/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${categoryId}`),
    inventoryRequest("GET", `/sell/metadata/v1/marketplace/EBAY_US/get_categories_as_aspects_for_listing?filter=conditionPolicies&category_ids=${categoryId}`),
  ]);

  // Also try to get the category name
  const categoryNameRes = await inventoryRequest("GET",
    `/commerce/taxonomy/v1/category_tree/0/category_subtree?category_id=${categoryId}`
  );

  return NextResponse.json({
    categoryId,
    sku,
    allOffers: allOffersRes.data,
    skuOffer: skuOfferRes.data,
    categoryAspects: categoryAspectsRes.data,
    conditionPolicies: conditionPoliciesRes.data,
    categoryName: categoryNameRes.data,
  }, { status: 200 });
}
