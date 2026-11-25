import { draftFieldsError, isUuid } from "@/lib/input-validation";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { deleteDraftsCompletely } from "@/lib/draft-delete";
import { serviceDb } from "@/lib/jobs/supabase-store";
import { sanitizeStoredSpecifics } from "@/lib/item-specifics";
import { isValidCostBasis } from "@/lib/profit";
import { withoutMissingColumn } from "@/lib/draft-row";
import { storedFloorError } from "@/lib/offer-floor";

// Same guard as POST /api/drafts -- see that file for why isHeavy/
// shippingCost are persisted here now instead of living only in
// drafts/[id]'s own localStorage cache.
function isValidShippingCost(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// Same guard as POST /api/drafts — store category IDs are always numeric
// and always picked from a live dropdown, never hand-typed.
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  const { data, error } = await auth.supabase
    .from("drafts")
    .select("*")
    .eq("id", id)
    // Belt-and-suspenders alongside RLS: RLS already scopes this table to
    // auth.uid(), but an explicit ownership check here means a draft that
    // isn't the caller's own returns the same "not found" response as one
    // that doesn't exist at all, rather than depending solely on RLS to
    // stop a cross-account ID guess.
    .eq("user_id", auth.user.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ draft: data });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isUuid(id)) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  const fieldsError = draftFieldsError(body);
  if (fieldsError) return NextResponse.json({ error: fieldsError }, { status: 400 });
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
  if (body.bestOfferFloor !== undefined && body.bestOfferFloor !== null) {
    // Checked against the price in this same save; a floor-only save is
    // checked against the saved price below.
    if (body.suggestedPrice !== undefined) {
      const floorErr = storedFloorError(body.suggestedPrice, body.bestOfferFloor);
      if (floorErr) return NextResponse.json({ error: floorErr }, { status: 400 });
    } else {
      const { data: cur } = await auth.supabase.from("drafts").select("suggested_price").eq("id", id).eq("user_id", auth.user.id).maybeSingle();
      const floorErr = storedFloorError(cur?.suggested_price ?? null, body.bestOfferFloor);
      if (floorErr) return NextResponse.json({ error: floorErr }, { status: 400 });
    }
  }
  const expectedUpdatedAt = body.expectedUpdatedAt;
  if (expectedUpdatedAt !== undefined && (typeof expectedUpdatedAt !== "string" || !expectedUpdatedAt)) {
    return NextResponse.json({ error: "Invalid draft version." }, { status: 400 });
  }

  const specifics = body.itemSpecifics !== undefined ? sanitizeStoredSpecifics(body.itemSpecifics) : undefined;
  const patch = {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.brand !== undefined && { brand: body.brand }),
      ...(body.color !== undefined && { color: body.color }),
      ...(body.size !== undefined && { size: body.size }),
      ...(body.condition !== undefined && { condition: body.condition }),
      ...(body.flaws !== undefined && { flaws: body.flaws }),
      ...(body.suggestedPrice !== undefined && { suggested_price: body.suggestedPrice }),
      ...(body.customSku !== undefined && { custom_sku: normalizeCustomSku(body.customSku) }),
      ...(body.itemType !== undefined && { item_type: body.itemType }),
      ...(body.style !== undefined && { style: body.style }),
      ...(body.material !== undefined && { material: body.material }),
      ...(body.theme !== undefined && { theme: body.theme }),
      ...(body.sleeveLength !== undefined && { sleeve_length: body.sleeveLength }),
      ...(body.neckline !== undefined && { neckline: body.neckline }),
      ...(body.fit !== undefined && { fit: body.fit }),
      ...(body.pattern !== undefined && { pattern: body.pattern }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.vintage !== undefined && { vintage: body.vintage }),
      ...(body.character !== undefined && { character: body.character }),
      ...(body.characterFamily !== undefined && { character_family: body.characterFamily }),
      ...(body.yearManufactured !== undefined && { year_manufactured: body.yearManufactured }),
      ...(body.season !== undefined && { season: body.season }),
      // Only the server unlinks a listing (delist/relist). A client save can
      // link an item number but never clear one -- a stale editor sending
      // null used to be able to drop a live item back into Drafts.
      ...(typeof body.ebayListingId === "string" && { ebay_listing_id: body.ebayListingId }),
      ...(body.photoUrls !== undefined && { photo_urls: body.photoUrls }),
      ...(body.thumbnailUrl !== undefined && { thumbnail_url: body.thumbnailUrl }),
      ...(body.avgSold !== undefined && { avg_sold: body.avgSold }),
      ...(body.activeRangeLow !== undefined && { active_range_low: body.activeRangeLow }),
      ...(body.activeRangeHigh !== undefined && { active_range_high: body.activeRangeHigh }),
      ...(body.sellOdds !== undefined && { sell_odds: body.sellOdds }),
      ...(body.storeCategoryId !== undefined && { store_category_id: body.storeCategoryId }),
      ...(body.storeCategoryName !== undefined && { store_category_name: body.storeCategoryName }),
      ...(body.costBasis !== undefined && { cost_basis: body.costBasis }),
      ...(body.isHeavy !== undefined && { is_heavy: body.isHeavy }),
      ...(body.shippingCost !== undefined && { shipping_cost: body.shippingCost }),
      ...(body.shippingMode !== undefined && { shipping_mode: "calculated" }), // calculated-only
      ...(specifics !== undefined && { item_specifics: specifics }),
      ...(body.bestOfferFloor !== undefined && { best_offer_floor: body.bestOfferFloor ?? null }),
  };
  const run = (values: Record<string, unknown>) => {
    let q = auth.supabase.from("drafts").update(values).eq("id", id).eq("user_id", auth.user!.id);
    if (expectedUpdatedAt) q = q.eq("updated_at", expectedUpdatedAt);
    return q.select().maybeSingle();
  };
  let values: Record<string, unknown> = patch;
  let { data, error } = await run(values);
  // Migrations 027/035 not applied yet: save the rest instead of failing.
  for (let tries = 0; error && tries < 2; tries++) {
    const rest = withoutMissingColumn(values, error);
    if (!rest) break;
    values = rest;
    ({ data, error } = await run(values));
  }

  if (error) {
    if (error.code === "23505" && error.message.toLowerCase().includes("custom_sku")) {
      return NextResponse.json({ error: "That SKU is already used by another draft. Choose a different SKU." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "This draft changed in another tab. Reload it before saving your changes.", stale: true },
      { status: 409 }
    );
  }
  return NextResponse.json({ draft: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  try {
    const r = await deleteDraftsCompletely(auth.supabase, process.env.SUPABASE_SERVICE_ROLE_KEY ? serviceDb() : auth.supabase, auth.user.id, [id], process.env.NEXT_PUBLIC_SUPABASE_URL!);
    // Already gone counts as success for the caller (idempotent), but says so.
    return NextResponse.json({ deleted: true, alreadyGone: r.deleted.length === 0, photosRemoved: r.photosRemoved }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
