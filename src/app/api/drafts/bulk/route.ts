import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isValidBulkEdit, previewBulkEdit, type BulkEdit } from "@/lib/bulk-edit";

export const runtime = "nodejs";

const MAX_IDS = 200;

// PATCH /api/drafts/bulk  { ids: string[], edit: BulkEdit }
// Re-computes every change server-side from the stored draft (same pure
// function the preview uses), scoped to the signed-in seller.
export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;

  let body: { ids?: unknown; edit?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, MAX_IDS) : [];
  if (ids.length === 0) return NextResponse.json({ error: "Select at least one draft." }, { status: 400 });
  if (!isValidBulkEdit(body.edit)) return NextResponse.json({ error: "That edit isn't valid." }, { status: 400 });
  const edit = body.edit as BulkEdit;

  const { data: drafts, error } = await supabase
    .from("drafts")
    .select("id, title, suggested_price, condition, ebay_listing_id")
    .eq("user_id", user.id)
    .in("id", ids);
  if (error) return NextResponse.json({ error: "Couldn't load those drafts." }, { status: 500 });

  // Live listings are edited from Listings (price only); bulk edit here
  // only touches drafts that aren't on eBay yet.
  const editable = (drafts ?? []).filter((d) => !d.ebay_listing_id);
  const rows = previewBulkEdit(
    editable.map((d) => ({ id: d.id as string, title: d.title as string | null, price: d.suggested_price as number | null, condition: d.condition as string | null })),
    edit,
  );

  let updated = 0;
  const failed: string[] = [];
  for (const r of rows) {
    if (Object.keys(r.patch).length === 0) continue;
    const { error: upErr } = await supabase.from("drafts").update(r.patch).eq("id", r.id).eq("user_id", user.id);
    if (upErr) failed.push(r.id);
    else updated++;
  }
  return NextResponse.json({
    updated,
    unchanged: rows.filter((r) => Object.keys(r.patch).length === 0).length,
    skippedLive: (drafts ?? []).length - editable.length,
    failed,
    warnings: rows.filter((r) => r.warnings.length).map((r) => ({ id: r.id, warnings: r.warnings })),
  });
}
