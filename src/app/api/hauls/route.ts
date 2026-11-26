import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { haulBodyError, haulFromRow, isMissingRelation } from "@/lib/hauls";

export const runtime = "nodejs";

const PENDING = { available: false, error: "Hauls need a one-time database update (migration 041)." };

// GET: every haul + the drafts that belong to one (id, title, cost, listing, price).
// Profit is worked out in the browser from the Sales feed it already loads.
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;
  const { data: hauls, error } = await supabase
    .from("hauls")
    .select("id, name, source, bought_on, total_cost, weight_lb, notes, split_mode")
    .eq("user_id", user.id)
    .order("bought_on", { ascending: false })
    .limit(500);
  if (error) {
    if (isMissingRelation(error, "hauls")) return NextResponse.json(PENDING);
    return NextResponse.json({ error: "Couldn't load hauls." }, { status: 500 });
  }
  const { data: drafts, error: dErr } = await supabase
    .from("drafts")
    .select("id, haul_id, title, cost_basis, ebay_listing_id, suggested_price, thumbnail_url")
    .eq("user_id", user.id)
    .not("haul_id", "is", null)
    .limit(10_000);
  if (dErr) {
    if (isMissingRelation(dErr, "haul_id")) return NextResponse.json(PENDING);
    return NextResponse.json({ error: "Couldn't load haul items." }, { status: 500 });
  }
  // Items not in any haul yet (newest first), for "Add items".
  const { data: cands } = await supabase
    .from("drafts")
    .select("id, title, cost_basis, ebay_listing_id, suggested_price, thumbnail_url, created_at")
    .eq("user_id", user.id)
    .is("haul_id", null)
    .order("created_at", { ascending: false })
    .limit(300);
  return NextResponse.json({
    available: true,
    candidates: (cands ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      costBasis: d.cost_basis == null ? null : Number(d.cost_basis),
      listingId: d.ebay_listing_id,
      price: d.suggested_price == null ? null : Number(d.suggested_price),
      thumbnail: d.thumbnail_url,
      createdAt: d.created_at,
    })),
    hauls: (hauls ?? []).map(haulFromRow),
    drafts: (drafts ?? []).map((d) => ({
      id: d.id,
      haulId: d.haul_id,
      title: d.title,
      costBasis: d.cost_basis == null ? null : Number(d.cost_basis),
      listingId: d.ebay_listing_id,
      price: d.suggested_price == null ? null : Number(d.suggested_price),
      thumbnail: d.thumbnail_url,
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  const err = haulBodyError(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const { data, error } = await supabase
    .from("hauls")
    .insert({
      user_id: user.id,
      name: (body.name as string).trim(),
      source: typeof body.source === "string" ? body.source.trim() || null : null,
      ...(typeof body.boughtOn === "string" && { bought_on: body.boughtOn }),
      total_cost: Math.round((body.totalCost as number) * 100) / 100,
      weight_lb: typeof body.weightLb === "number" ? body.weightLb : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      split_mode: body.splitMode === "price" ? "price" : "even",
    })
    .select("id, name, source, bought_on, total_cost, weight_lb, notes, split_mode")
    .single();
  if (error) {
    if (isMissingRelation(error, "hauls")) return NextResponse.json(PENDING, { status: 409 });
    return NextResponse.json({ error: "Couldn't save the haul." }, { status: 500 });
  }
  return NextResponse.json({ haul: haulFromRow(data) });
}
