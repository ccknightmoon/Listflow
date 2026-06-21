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
      ...(body.sleevLength !== undefined && { sleeve_length: body.sleevLength }),
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
