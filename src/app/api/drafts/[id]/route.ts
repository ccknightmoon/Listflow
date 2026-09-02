import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

// Same guard as POST /api/drafts — store category IDs are always numeric
// and always picked from a live dropdown, never hand-typed.
function isValidStoreCategoryId(value: unknown): value is string | null {
  return value === null || value === undefined || (typeof value === "string" && /^\d+$/.test(value));
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const { data, error } = await auth.supabase
    .from("drafts")
    .select("*")
    .eq("id", params.id)
    // Belt-and-suspenders alongside RLS: RLS already scopes this table to
    // auth.uid(), but an explicit ownership check here means a draft that
    // isn't the caller's own returns the same "not found" response as one
    // that doesn't exist at all, rather than depending solely on RLS to
    // stop a cross-account ID guess.
    .eq("user_id", auth.user.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ draft: data });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isValidStoreCategoryId(body.storeCategoryId)) {
    return NextResponse.json({ error: "Invalid store category ID." }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("drafts")
    .update({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.brand !== undefined && { brand: body.brand }),
      ...(body.color !== undefined && { color: body.color }),
      ...(body.size !== undefined && { size: body.size }),
      ...(body.condition !== undefined && { condition: body.condition }),
      ...(body.flaws !== undefined && { flaws: body.flaws }),
      ...(body.suggestedPrice !== undefined && { suggested_price: body.suggestedPrice }),
      ...(body.customSku !== undefined && { custom_sku: body.customSku }),
      ...(body.itemType !== undefined && { item_type: body.itemType }),
      ...(body.style !== undefined && { style: body.style }),
      ...(body.material !== undefined && { material: body.material }),
      ...(body.theme !== undefined && { theme: body.theme }),
      ...(body.sleeveLength !== undefined && { sleeve_length: body.sleeveLength }),
      ...(body.neckline !== undefined && { neckline: body.neckline }),
      ...(body.fit !== undefined && { fit: body.fit }),
      ...(body.pattern !== undefined && { pattern: body.pattern }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.vintage !== undefined && { vintage: body.vintage }),
      ...(body.character !== undefined && { character: body.character }),
      ...(body.characterFamily !== undefined && { character_family: body.characterFamily }),
      ...(body.yearManufactured !== undefined && { year_manufactured: body.yearManufactured }),
      ...(body.season !== undefined && { season: body.season }),
      ...(body.ebayListingId !== undefined && { ebay_listing_id: body.ebayListingId }),
      ...(body.photoUrls !== undefined && { photo_urls: body.photoUrls }),
      ...(body.thumbnailUrl !== undefined && { thumbnail_url: body.thumbnailUrl }),
      ...(body.avgSold !== undefined && { avg_sold: body.avgSold }),
      ...(body.activeRangeLow !== undefined && { active_range_low: body.activeRangeLow }),
      ...(body.activeRangeHigh !== undefined && { active_range_high: body.activeRangeHigh }),
      ...(body.sellOdds !== undefined && { sell_odds: body.sellOdds }),
      ...(body.storeCategoryId !== undefined && { store_category_id: body.storeCategoryId }),
      ...(body.storeCategoryName !== undefined && { store_category_name: body.storeCategoryName }),
    })
    .eq("id", params.id)
    .eq("user_id", auth.user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ draft: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const { error } = await auth.supabase.from("drafts").delete().eq("id", params.id).eq("user_id", auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
