import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isValidCostBasis } from "@/lib/profit";
import { getListingReadiness } from "@/lib/listing-readiness";

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

// Narrowed to exactly what the Drafts list screen renders (src/app/drafts/
// page.tsx's own Draft interface) instead of select("*") -- the full row
// also carries the AI-generated description, photo_urls, and a dozen+
// item-attribute columns (style, material, theme, sleeve_length, ...) that
// this list view never reads. Those only matter once a single draft is
// opened for editing, which fetches its own full row separately (see GET
// /api/drafts/[id]). A seller with a large draft backlog was shipping all
// of that unused text over the wire on every visit to this page. photo_urls
// itself is kept (only this one array) since the list needs its length for
// the "needs-photo" filter and readiness check below.
const DRAFTS_SELECT_COLUMNS =
  "id, title, suggested_price, sell_odds, condition, thumbnail_url, photo_urls, created_at, ebay_listing_id, is_heavy, shipping_cost, shipping_mode";

const SORT_KEYS = new Set(["newest", "oldest", "price-desc", "price-asc"]);
const FILTER_KEYS = new Set(["all", "ready", "needs-photo", "needs-price"]);
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

function draftsQueryError(error: { code?: string; message: string }) {
  if (error.code === "23505" && error.message.toLowerCase().includes("custom_sku")) {
    return NextResponse.json({ error: "That SKU is already used by another draft. Choose a different SKU." }, { status: 409 });
  }
  return NextResponse.json({ error: error.message }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const url = new URL(req.url);
  const search = (url.searchParams.get("search") ?? "").trim();
  const rawSort = url.searchParams.get("sort") ?? "newest";
  const sort = SORT_KEYS.has(rawSort) ? rawSort : "newest";
  const rawFilter = url.searchParams.get("filter") ?? "all";
  const filter = FILTER_KEYS.has(rawFilter) ? rawFilter : "all";
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page"))) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(Number(url.searchParams.get("pageSize"))) || DEFAULT_PAGE_SIZE)
  );

  // Only ever returns drafts that haven't been listed yet -- the drafts
  // screen has always dropped listed items after fetching everything (see
  // drafts/page.tsx's old client-side `!d.ebay_listing_id` filter);
  // pushing that same exclusion into the query itself is the same pattern
  // dashboard/stats/route.ts already uses for its own "unlisted" count.
  let query = auth.supabase
    .from("drafts")
    .select(DRAFTS_SELECT_COLUMNS, { count: "exact" })
    .is("ebay_listing_id", null);

  if (search) {
    query = query.ilike("title", `%${search}%`);
  }
  if (filter === "needs-price") {
    query = query.is("suggested_price", null);
  }
  // "needs-photo" is a true DB filter now (photo_urls is text[] --
  // confirmed against the live schema): null or the empty array literal
  // covers every draft with zero photos, same as the old
  // (d.photo_urls?.length ?? 0) === 0 in-memory check. This moves
  // "needs-photo" onto the same range()-paginated path as "all"/
  // "needs-price" below instead of loading every unlisted draft into
  // memory to filter it in JS.
  if (filter === "needs-photo") {
    query = query.or("photo_urls.is.null,photo_urls.eq.{}");
  }
  // "ready" still needs the full getListingReadiness() check below (its
  // >24-photo blocker isn't expressible as a plain column filter), but
  // title/price/condition each being set is a hard requirement for
  // "ready" and IS expressible here -- pushing these down first shrinks
  // what actually has to be loaded into memory and filtered in JS to
  // roughly just the drafts that are plausibly ready, instead of every
  // unlisted draft regardless of how incomplete it is.
  if (filter === "ready") {
    query = query
      .not("title", "is", null)
      .neq("title", "")
      .not("suggested_price", "is", null)
      .gt("suggested_price", 0)
      .not("condition", "is", null)
      .neq("condition", "");
  }

  const sortColumn = sort === "price-desc" || sort === "price-asc" ? "suggested_price" : "created_at";
  query = query.order(sortColumn, {
    ascending: sort === "oldest" || sort === "price-asc",
    nullsFirst: false,
  });

  // "needs-photo" and "ready" each combine several columns (photo count,
  // title, price, condition, shipping mode) in ways a single Postgrest
  // column filter can't express. Rather than guess at raw SQL against a
  // column whose exact array type isn't pinned down here, this reuses the
  // exact readiness/photo-count logic drafts/page.tsx used to run
  // client-side -- just moved server-side, still scoped by the same search
  // text and unlisted-only condition above, so results are byte-for-byte
  // the same as before this change. Only "all" and "needs-price" get true
  // range()-based DB pagination; these two paginate in memory after
  // filtering, which still avoids sending the unused description/
  // item-attribute columns the old full-row select used to.
  // Only "ready" still needs an in-memory pass -- the >24-photo blocker
  // and the 80-char title-length blocker aren't expressible as plain
  // column filters, and getListingReadiness() is the single source of
  // truth for what "ready" means everywhere else in the app (the Drafts
  // list UI, drafts/[id]). The DB-level pre-filter above already
  // narrowed this to drafts that have a title/price/condition set, so
  // this only loads the plausibly-ready subset, not every unlisted
  // draft.
  if (filter === "ready") {
    const { data, error } = await query;
    if (error) return draftsQueryError(error);
    const rows = data ?? [];
    const matching = rows.filter((d) =>
      getListingReadiness({
        photoCount: d.photo_urls?.length ?? (d.thumbnail_url ? 1 : 0),
        title: d.title,
        price: d.suggested_price,
        condition: d.condition,
        shippingMode: d.shipping_mode ?? "free",
      }).ready
    );
    const total = matching.length;
    const start = (page - 1) * pageSize;
    return NextResponse.json({
      drafts: matching.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  }

  const start = (page - 1) * pageSize;
  const { data, error, count } = await query.range(start, start + pageSize - 1);
  if (error) return draftsQueryError(error);

  const total = count ?? data?.length ?? 0;
  return NextResponse.json({
    drafts: data,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
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
