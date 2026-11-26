import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isValidCostBasis } from "@/lib/profit";
import { invalidateSalesFeed } from "@/lib/sales-feed-cache";

export const runtime = "nodejs";

// Save the item cost for one sale (Sales page "Add costs").
// - Sale listed through Listflow -> saved on its draft (drafts.cost_basis),
//   works today.
// - Sale with no draft -> saved in sale_costs, which needs migration 040 (replaces 025).
//   If that table doesn't exist yet the response says so (needsMigration)
//   instead of failing silently.
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;

  let body: { saleKey?: unknown; listingId?: unknown; cost?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const saleKey = typeof body.saleKey === "string" ? body.saleKey.trim() : "";
  const listingId = typeof body.listingId === "string" ? body.listingId.trim() : "";
  const cost = typeof body.cost === "number" ? Math.round(body.cost * 100) / 100 : NaN;
  if (!saleKey || !/^\d{6,15}$/.test(listingId) || !saleKey.startsWith(`${listingId}-`)) {
    return NextResponse.json({ error: "Missing or invalid sale." }, { status: 400 });
  }
  if (!isValidCostBasis(cost) || cost > 100000) {
    return NextResponse.json({ error: "Enter a cost of $0 or more." }, { status: 400 });
  }

  const { data: draft } = await supabase
    .from("drafts")
    .select("id")
    .eq("user_id", user.id)
    .eq("ebay_listing_id", listingId)
    .limit(1)
    .maybeSingle();

  if (draft) {
    const { error } = await supabase.from("drafts").update({ cost_basis: cost }).eq("id", draft.id).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: "Couldn't save that cost. Try again." }, { status: 500 });
    invalidateSalesFeed(user.id);
    return NextResponse.json({ success: true, savedTo: "draft" });
  }

  const { error } = await supabase
    .from("sale_costs")
    .upsert({ user_id: user.id, sale_key: saleKey, ebay_listing_id: listingId, cost, updated_at: new Date().toISOString() });
  if (error) {
    const missingTable = error.code === "42P01" || error.code === "PGRST205" || /sale_costs/.test(error.message ?? "");
    if (missingTable) {
      return NextResponse.json({
        error: "Costs for items listed outside Listflow need a one-time database update (migration 040).",
        needsMigration: true,
      }, { status: 409 });
    }
    return NextResponse.json({ error: "Couldn't save that cost. Try again." }, { status: 500 });
  }
  invalidateSalesFeed(user.id);
  return NextResponse.json({ success: true, savedTo: "sale_costs" });
}
