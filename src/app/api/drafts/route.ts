import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

// eBay Store Category IDs are always numeric (see ebay-store-categories.ts,
// which already guards its own XML-interpolation point the same way). This
// app never lets a seller type a category ID by hand — it's always picked
// from a live dropdown of the seller's real categories — so a non-numeric
// value here means either a bug or a tampered request, not a legitimate
// use case. Rejecting it at the API boundary (rather than trusting the
// eBay-call-time guard alone) keeps bad data out of the database entirely.
function isValidStoreCategoryId(value: unknown): value is string | null {
  return value === null || value === undefined || (typeof value === "string" && /^\d+$/.test(value));
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  // Narrowed to exactly what the Drafts list screen renders (src/app/drafts/
  // page.tsx's own Draft interface) instead of select("*") -- the full row
  // also carries the AI-generated description, photo_urls, and a dozen+
  // item-attribute columns (style, material, theme, sleeve_length, ...)
  // that this list view never reads. Those only matter once a single draft
  // is opened for editing, which fetches its own full row separately (see
  // GET /api/drafts/[id]). A seller with a large draft backlog was shipping
  // all of that unused text over the wire on every visit to this page.
  const { data, error } = await auth.supabase
    .from("drafts")
    .select("id, title, suggested_price, sell_odds, condition, thumbnail_url, created_at, ebay_listing_id")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ drafts: data });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  let body: { ids?: string[] };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const ids = body.ids ?? [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "No ids provided." }, { status: 400 });
  }

  const { error } = await auth.supabase.from("drafts").delete().in("id", ids).eq("user_id", auth.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: ids.length });
}

export async function POST(req: NextRequest) {
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
    .insert([
      {
        // Explicit stamp, even though the DB column also defaults to
        // auth.uid() — defense-in-depth matches the rest of this codebase.
        user_id: auth.user.id,
        title: body.title ?? null,
        brand: body.brand ?? null,
        color: body.color ?? null,
        size: body.size ?? null,
        condition: body.condition ?? null,
        flaws: body.flaws ?? null,
        suggested_price: body.suggestedPrice ?? null,
        avg_sold: body.avgSold ?? null,
        active_range_low: body.activeRangeLow ?? null,
        active_range_high: body.activeRangeHigh ?? null,
        sell_odds: body.sellOdds ?? null,
        thumbnail_url: body.thumbnailUrl ?? null,
        photo_urls: body.photoUrls ?? null,
        item_type: body.itemType ?? null,
        theme: body.theme ?? null,
        style: body.style ?? null,
        material: body.material ?? null,
        sleeve_length: body.sleeveLength ?? null,
        neckline: body.neckline ?? null,
        fit: body.fit ?? null,
        pattern: body.pattern ?? null,
        description: body.description ?? null,
        vintage: body.vintage ?? null,
        character: body.character ?? null,
        character_family: body.characterFamily ?? null,
        year_manufactured: body.yearManufactured ?? null,
        season: body.season ?? null,
        store_category_id: body.storeCategoryId ?? null,
        store_category_name: body.storeCategoryName ?? null,
      },
    ])
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ draft: data[0] });
}
