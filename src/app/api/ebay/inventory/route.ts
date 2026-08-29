import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  try {
    const { data: drafts, error } = await auth.supabase
      .from("drafts")
      .select("id, title, suggested_price, thumbnail_url, ebay_listing_id, created_at, custom_sku")
      .not("ebay_listing_id", "is", null)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const listings = (drafts ?? []).map((d) => {
      const hex = (d.id as string).replace(/-/g, "");
      const shortId = hex.slice(0, 8);
      return {
        draftId: d.id,
        sku: (d.custom_sku as string | null) ?? shortId,
        status: "PUBLISHED",
        listingId: d.ebay_listing_id as string,
        price: d.suggested_price?.toString() ?? null,
        title: (d.title as string) ?? d.id,
        thumbnail: (d.thumbnail_url as string) ?? null,
        startTime: (d.created_at as string) ?? null,
      };
    });

    return NextResponse.json({ listings });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
