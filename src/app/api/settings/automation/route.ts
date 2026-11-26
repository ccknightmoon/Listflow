import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { autoOffersLive, settingsFromRow } from "@/lib/auto-offers";

export const runtime = "nodejs";

// Automation settings, each group read/written on its own so a database
// missing one migration still loads/saves the others. Everything is OFF
// until the seller turns it on.
//   autoOffers   -> migration 042
//   learnFixes   -> migration 043
const AUTO_COLS = "auto_offers_enabled, auto_offers_percent, auto_offers_min_days, auto_offers_all_items, auto_offers_repeat_days";

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;
  const [auto, learn] = await Promise.all([
    supabase.from("app_settings").select(AUTO_COLS).eq("user_id", user.id).maybeSingle(),
    supabase.from("app_settings").select("learn_fixes_enabled").eq("user_id", user.id).maybeSingle(),
  ]);
  return NextResponse.json({
    autoOffers: auto.error ? null : settingsFromRow(auto.data as Record<string, unknown> | null),
    autoOffersLive: autoOffersLive(),
    learnFixes: learn.error ? null : (learn.data as { learn_fixes_enabled?: boolean } | null)?.learn_fixes_enabled === true,
  });
}

function intIn(v: unknown, lo: number, hi: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const patch: Record<string, unknown> = {};
  const a = body.autoOffers as Record<string, unknown> | undefined;
  if (a && typeof a === "object") {
    if (a.enabled !== undefined) { if (typeof a.enabled !== "boolean") return bad("enabled"); patch.auto_offers_enabled = a.enabled; }
    if (a.allItems !== undefined) { if (typeof a.allItems !== "boolean") return bad("allItems"); patch.auto_offers_all_items = a.allItems; }
    if (a.percent !== undefined) { const v = intIn(a.percent, 5, 50); if (v == null) return bad("percent (5–50)"); patch.auto_offers_percent = v; }
    if (a.minDays !== undefined) { const v = intIn(a.minDays, 0, 365); if (v == null) return bad("minDays (0–365)"); patch.auto_offers_min_days = v; }
    if (a.repeatDays !== undefined) { const v = intIn(a.repeatDays, 2, 90); if (v == null) return bad("repeatDays (2–90)"); patch.auto_offers_repeat_days = v; }
  }
  if (body.learnFixes !== undefined) {
    if (typeof body.learnFixes !== "boolean") return bad("learnFixes");
    patch.learn_fixes_enabled = body.learnFixes;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  const { error } = await supabase.from("app_settings").upsert({ user_id: user.id, ...patch }, { onConflict: "user_id" });
  if (error) {
    const pending = /auto_offers|learn_fixes/.test(error.message ?? "") || error.code === "PGRST204" || error.code === "42703";
    return NextResponse.json({ error: pending ? "This setting needs a one-time database update (migrations 042/043)." : "Couldn't save.", needsMigration: pending }, { status: pending ? 409 : 500 });
  }
  return NextResponse.json({ ok: true });
}

function bad(field: string) {
  return NextResponse.json({ error: `Invalid ${field}.` }, { status: 400 });
}
