import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

// "Duplicate this item" — for a seller listing several similar items (the
// same shirt in a few sizes, a small lot from one brand) without redoing
// the full AI-analysis flow from scratch for each one. Copies every
// descriptive/eBay-facing field from an existing draft into a brand new
// draft, but deliberately clears anything that has to be specific to the
// physical item being duplicated rather than the item's description:
//   - photo_urls/thumbnail_url — a duplicate is a DIFFERENT physical item;
//     carrying over the source's photos would misrepresent condition/
//     appearance for the new one, which cuts against this app's whole
//     point of showing buyers the actual item.
//   - custom_sku — must be unique; a fresh one is auto-assigned at listing
//     time same as any other new draft (see POST /api/ebay/list).
//   - ebay_listing_id — the new draft is never listed yet, regardless of
//     whether the source draft already was.
// Pricing fields (suggested_price, avg_sold, active_range, sell_odds) ARE
// carried over as a starting point — usually still roughly right for a
// near-identical item, and fully editable afterward like any draft field.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  const { data: source, error: fetchError } = await auth.supabase
    .from("drafts")
    .select("*")
    // Belt-and-suspenders alongside RLS, same pattern as GET/PATCH/DELETE
    // /api/drafts/[id] — a draft that isn't the caller's own reads back as
    // "not found" rather than depending solely on RLS to stop a guess.
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .single();

  if (fetchError || !source) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  const { data, error } = await auth.supabase
    .from("drafts")
    .insert([
      {
        user_id: auth.user.id,
        title: source.title,
        brand: source.brand,
        color: source.color,
        size: source.size,
        condition: source.condition,
        flaws: source.flaws,
        suggested_price: source.suggested_price,
        avg_sold: source.avg_sold,
        active_range_low: source.active_range_low,
        active_range_high: source.active_range_high,
        sell_odds: source.sell_odds,
        item_type: source.item_type,
        theme: source.theme,
        style: source.style,
        material: source.material,
        sleeve_length: source.sleeve_length,
        neckline: source.neckline,
        fit: source.fit,
        pattern: source.pattern,
        description: source.description,
        vintage: source.vintage,
        character: source.character,
        character_family: source.character_family,
        year_manufactured: source.year_manufactured,
        season: source.season,
        store_category_id: source.store_category_id,
        store_category_name: source.store_category_name,
        cost_basis: source.cost_basis,
        is_heavy: source.is_heavy ?? false,
        shipping_cost: source.shipping_cost,
        shipping_mode: source.shipping_mode ?? (source.is_heavy ? "buyer_pays" : "free"),
        // Deliberately NOT carried over — see comment above.
        photo_urls: null,
        thumbnail_url: null,
        custom_sku: null,
        ebay_listing_id: null,
      },
    ])
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ draft: data });
}
