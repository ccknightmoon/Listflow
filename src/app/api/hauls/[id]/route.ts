import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isUuid, uuidList } from "@/lib/input-validation";
import { invalidateSalesFeed } from "@/lib/sales-feed-cache";
import { haulBodyError, haulFromRow, splitHaulCost, type SplitMode } from "@/lib/hauls";

export const runtime = "nodejs";

// PATCH: edit a haul's details, and/or assign items to it.
//   { name?, source?, boughtOn?, totalCost?, weightLb?, notes?, splitMode?,
//     addDraftIds?: uuid[], removeDraftIds?: uuid[], applyCost?: boolean }
// applyCost re-splits the haul's total across ALL its items and writes each
// item's cost (drafts.cost_basis). Items whose cost was typed by hand are
// overwritten only when `overwrite: true` -- the UI asks first.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  const err = haulBodyError(body, true);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (body.source !== undefined) patch.source = typeof body.source === "string" ? body.source.trim() || null : null;
  if (typeof body.boughtOn === "string") patch.bought_on = body.boughtOn;
  if (typeof body.totalCost === "number") patch.total_cost = Math.round(body.totalCost * 100) / 100;
  if (body.weightLb !== undefined) patch.weight_lb = typeof body.weightLb === "number" ? body.weightLb : null;
  if (body.notes !== undefined) patch.notes = typeof body.notes === "string" ? body.notes : null;
  if (body.splitMode === "even" || body.splitMode === "price") patch.split_mode = body.splitMode;

  let haulRow: Record<string, unknown> | null = null;
  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("hauls").update(patch).eq("id", id).eq("user_id", user.id).select("*").maybeSingle();
    if (error) return NextResponse.json({ error: "Couldn't save the haul." }, { status: 500 });
    haulRow = data;
  } else {
    const { data } = await supabase.from("hauls").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
    haulRow = data;
  }
  if (!haulRow) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const add = body.addDraftIds !== undefined ? uuidList(body.addDraftIds) : [];
  const remove = body.removeDraftIds !== undefined ? uuidList(body.removeDraftIds) : [];
  if (add === null || remove === null) return NextResponse.json({ error: "Item ids must be 1–500 ids." }, { status: 400 });
  if (add.length) {
    const { error } = await supabase.from("drafts").update({ haul_id: id }).in("id", add).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: "Couldn't add items to the haul." }, { status: 500 });
  }
  if (remove.length) {
    const { error } = await supabase.from("drafts").update({ haul_id: null }).in("id", remove).eq("user_id", user.id).eq("haul_id", id);
    if (error) return NextResponse.json({ error: "Couldn't remove items." }, { status: 500 });
  }

  let costsWritten = 0;
  let skippedManual = 0;
  if (body.applyCost === true) {
    const { data: items, error } = await supabase
      .from("drafts")
      .select("id, suggested_price, cost_basis")
      .eq("user_id", user.id)
      .eq("haul_id", id)
      .limit(5000);
    if (error) return NextResponse.json({ error: "Couldn't load the haul's items." }, { status: 500 });
    const haul = haulFromRow(haulRow);
    const overwrite = body.overwrite === true;
    const all = items ?? [];
    // Overwrite: re-split the whole total across every item. Otherwise keep
    // costs already on items and split only what's left across the empty ones,
    // so the items still add up to the haul's total.
    const targets = overwrite ? all : all.filter((d) => d.cost_basis == null);
    skippedManual = all.length - targets.length;
    const kept = overwrite ? 0 : all.filter((d) => d.cost_basis != null).reduce((s, d) => s + Number(d.cost_basis), 0);
    const remaining = Math.max(0, Math.round((haul.totalCost - kept) * 100) / 100);
    const split = splitHaulCost(remaining, targets.map((d) => ({ id: d.id, price: d.suggested_price == null ? null : Number(d.suggested_price) })), haul.splitMode as SplitMode);
    for (const d of targets) {
      const { error: uErr } = await supabase.from("drafts").update({ cost_basis: split[d.id] ?? 0 }).eq("id", d.id).eq("user_id", user.id);
      if (!uErr) costsWritten++;
    }
  }
  if (costsWritten) invalidateSalesFeed(user.id);
  return NextResponse.json({ haul: haulFromRow(haulRow), costsWritten, skippedManual });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  // Items keep their cost; their haul link is cleared by the FK (on delete set null).
  const { error } = await auth.supabase.from("hauls").delete().eq("id", id).eq("user_id", auth.user.id);
  if (error) return NextResponse.json({ error: "Couldn't delete the haul." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
