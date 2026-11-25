import { uuidList } from "@/lib/input-validation";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isMissingColumnError } from "@/lib/item-specifics";
import { draftBodyError, draftRowFromBody } from "@/lib/draft-row";
import { getListingReadiness } from "@/lib/listing-readiness";
import { deleteDraftsCompletely } from "@/lib/draft-delete";
import { serviceDb } from "@/lib/jobs/supabase-store";

// isHeavy/shippingCost mirror the same fields POST /api/ebay/list already
// accepts at listing time -- persisting them here too means a heavy item
// saved as a draft (not listed immediately) keeps its shipping flag instead
// of silently losing it (previously the flag only ever reached the DB via
// drafts/[id]'s own localStorage cache, which a draft saved from
// new-listing/batch-upload never touched at all).
const DRAFTS_SELECT_COLUMNS =
  "id, title, suggested_price, sell_odds, condition, thumbnail_url, photo_urls, created_at, updated_at, ebay_listing_id, is_heavy, shipping_cost, shipping_mode, custom_sku";

const SORT_KEYS = new Set(["newest", "oldest", "edited", "price-desc", "price-asc"]);
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

  // Order is always total: drafts saved in the same batch share a
  // created_at to the millisecond, and without a tiebreaker Postgres may
  // return them in a different order per page/refresh (items "jumping").
  // Default "newest": most recently saved first. "edited": last changed first.
  const sortColumn =
    sort === "price-desc" || sort === "price-asc" ? "suggested_price" : sort === "edited" ? "updated_at" : "created_at";
  const ascending = sort === "oldest" || sort === "price-asc";
  query = query.order(sortColumn, { ascending, nullsFirst: false });
  if (sortColumn !== "created_at") query = query.order("created_at", { ascending: false });
  query = query.order("id", { ascending });

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
        shippingMode: "calculated", // calculated-only since Nov 15, 2026
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

  const ids = uuidList(body.ids);
  if (!ids) {
    return NextResponse.json({ error: "ids must be a list of 1–500 draft IDs." }, { status: 400 });
  }

  // Permanent: row + its photos in storage. Answers with the ids that were
  // really removed (an id that wasn't there is reported, not "deleted").
  try {
    const r = await deleteDraftsCompletely(auth.supabase, process.env.SUPABASE_SERVICE_ROLE_KEY ? serviceDb() : auth.supabase, auth.user.id, ids, process.env.NEXT_PUBLIC_SUPABASE_URL!);
    return NextResponse.json({ ...r, deletedCount: r.deleted.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
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

  const invalid = draftBodyError(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const row = draftRowFromBody(auth.user.id, body);
  let { data, error } = await auth.supabase.from("drafts").insert([row]).select();
  // Before migration 027 is applied the item_specifics column doesn't exist:
  // save everything else rather than failing the whole draft.
  if (error && isMissingColumnError(error, "item_specifics")) {
    const { item_specifics: _drop, ...rest } = row as typeof row & { item_specifics?: unknown };
    void _drop;
    ({ data, error } = await auth.supabase.from("drafts").insert([rest]).select());
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ draft: data?.[0] });
}
