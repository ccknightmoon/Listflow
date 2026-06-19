import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

export async function GET() {
  try {
    const { data: drafts, error } = await supabase
      .from("drafts")
      .select("id, title, suggested_price, thumbnail_url, ebay_listing_id, brand, size, condition")
      .not("ebay_listing_id", "is", null)
      .order("id", { ascending: false });

    if (error) throw new Error(error.message);

    const listings = (drafts ?? []).map((d) => ({
      draftId: d.id as string,
      listingId: d.ebay_listing_id as string,
      title: (d.title as string) ?? "Untitled",
      price: d.suggested_price as number | null,
      thumbnail: (d.thumbnail_url as string) ?? null,
      brand: (d.brand as string) ?? null,
      size: (d.size as string) ?? null,
      condition: (d.condition as string) ?? null,
    }));

    return NextResponse.json({ listings, total: listings.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
