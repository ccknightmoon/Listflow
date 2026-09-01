import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

// One settings row per user (keyed by user_id, see the multi-tenant
// isolation migration) — each account has its own default shipping mode.
// A brand-new account has no row yet until its first PATCH, which upserts
// one into existence; per-item overrides still live on the listing screens
// themselves (ShippingModeControl).
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;

  const { data, error } = await supabase
    .from("app_settings")
    .select("default_shipping_mode")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) {
    // No row yet for this user (never saved Settings before) — fall back
    // to "free" rather than failing the page.
    return NextResponse.json({ defaultShippingMode: "free" });
  }
  return NextResponse.json({ defaultShippingMode: data.default_shipping_mode });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;

  const { defaultShippingMode } = await req.json();
  if (defaultShippingMode !== "free" && defaultShippingMode !== "calculated") {
    return NextResponse.json({ error: "defaultShippingMode must be 'free' or 'calculated'" }, { status: 400 });
  }

  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { user_id: user.id, default_shipping_mode: defaultShippingMode, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, defaultShippingMode });
}
