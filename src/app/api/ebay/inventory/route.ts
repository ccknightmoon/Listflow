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
      .select("id, title, suggested_price, thumbnail_url, ebay_listing_id")
      .not("ebay_listing_id", "is", null)
      .order("id", { ascending: false });

    if (error) throw new Error(error.message);

    const listings = (drafts ?? []).map((d) => ({
      draftId: d.id,
      sku: `listflow${(d.id as string).replace(/-/g, "")}`,
      status: "PUBLISHED",
      listingId: d.ebay_listing_id as string,
      price: d.suggested_price?.toString() ?? null,
      title: (d.title as string) ?? d.id,
      thumbnail: (d.thumbnail_url as string) ?? null,
    }));

    return NextResponse.json({ listings });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
