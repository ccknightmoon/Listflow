import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await supabase
    .from("drafts")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ draft: data });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("drafts")
    .update({
      title: body.title ?? null,
      brand: body.brand ?? null,
      color: body.color ?? null,
      size: body.size ?? null,
      condition: body.condition ?? null,
      flaws: body.flaws ?? null,
      suggested_price: body.suggestedPrice ?? null,
      custom_sku: body.customSku ?? null,
      item_type: body.itemType ?? null,
      style: body.style ?? null,
      material: body.material ?? null,
      theme: body.theme ?? null,
      sleeve_length: body.sleevLength ?? null,
      neckline: body.neckline ?? null,
      fit: body.fit ?? null,
      pattern: body.pattern ?? null,
      description: body.description ?? null,
      vintage: body.vintage ?? null,
      character: body.character ?? null,
      character_family: body.characterFamily ?? null,
      year_manufactured: body.yearManufactured ?? null,
      season: body.season ?? null,
      ...(body.ebayListingId !== undefined && { ebay_listing_id: body.ebayListingId }),
      ...(body.photoUrls !== undefined && { photo_urls: body.photoUrls }),
      ...(body.thumbnailUrl !== undefined && { thumbnail_url: body.thumbnailUrl }),
      ...(body.avgSold !== undefined && { avg_sold: body.avgSold }),
      ...(body.sellOdds !== undefined && { sell_odds: body.sellOdds }),
    })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ draft: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await supabase.from("drafts").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
