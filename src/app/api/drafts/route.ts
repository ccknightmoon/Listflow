import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isValidCostBasis } from "@/lib/profit";

// isHeavy/shippingCost mirror the same fields POST /api/ebay/list already
// accepts at listing time -- persisting them here too means a heavy item
// saved as a draft (not listed immediately) keeps its shipping flag instead
// of silently losing it (previously the flag only ever reached the DB via
// drafts/[id]'s own localStorage cache, which a draft saved from
// new-listing/batch-upload never touched at all).
function isValidShippingCost(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

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
function isValidShippingMode(value: unknown): value is "free" | "calculated" | "buyer_pays" {
  return value === "free" || value === "calculated" || value === "buyer_pays";
}

function normalizeCustomSku(value: unknown): string | null {
  if (typeof value !== "string") return value == null ? null : String(value);
  const sku = value.trim();
  return sku || null;
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
    .select("id, title, suggested_price, sell_odds, condition, thumbnail_url, created_at, ebay_listing_id, is_heavy, shipping_cost, shipping_mode")
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
  if (body.costBasis !== undefined && body.costBasis !== null && !isValidCostBasis(body.costBasis)) {
    return NextResponse.json({ error: "costBasis must be a non-negative number, or null." }, { status: 400 });
  }
  if (body.isHeavy !== undefined && typeof body.isHeavy !== "boolean") {
    return NextResponse.json({ error: "isHeavy must be a boolean." }, { status: 400 });
  }
  if (body.shippingCost !== undefined && body.shippingCost !== null && !isValidShippingCost(body.shippingCost)) {
    return NextResponse.json({ error: "shippingCost must be a non-negative number, or null." }, { status: 400 });
  }
  if (body.shippingMode !== undefined && !isValidShippingMode(body.shippingMode)) {
    return NextResponse.json({ error: "shippingMode must be 'free', 'calculated', or 'buyer_pays'." }, { status: 400 });
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
        custom_sku: normalizeCustomSku(body.customSku),
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
        cost_basis: body.costBasis ?? null,
        is_heavy: body.isHeavy ?? false,
        shipping_cost: body.shippingCost ?? null,
        shipping_mode: body.shippingMode ?? (body.isHeavy ? "buyer_pays" : "free"),
      },
    ])
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ draft: data[0] });
}
