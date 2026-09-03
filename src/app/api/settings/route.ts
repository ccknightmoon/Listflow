import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

const ACCENT_COLORS = ["indigo", "sapphire", "emerald", "amber", "rose", "teal"];

// One settings row per user (keyed by user_id, see the multi-tenant
// isolation migration) — each account has its own default shipping mode,
// store description footer, and accent color. A brand-new account has no
// row yet until its first PATCH, which upserts one into existence; per-item
// shipping overrides still live on the listing screens themselves
// (the "Heavy item" checkbox).
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;

  const { data, error } = await supabase
    .from("app_settings")
    .select("default_shipping_mode, store_description_footer, accent_color")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) {
    // No row yet for this user (never saved Settings before) — fall back
    // to "free"/no footer/indigo rather than failing the page.
    return NextResponse.json({ defaultShippingMode: "free", storeDescriptionFooter: "", accentColor: "indigo" });
  }
  return NextResponse.json({
    defaultShippingMode: data.default_shipping_mode,
    storeDescriptionFooter: data.store_description_footer ?? "",
    accentColor: data.accent_color ?? "indigo",
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;

  const body = await req.json();
  const { defaultShippingMode, storeDescriptionFooter, accentColor } = body;

  if (defaultShippingMode !== undefined && defaultShippingMode !== "free" && defaultShippingMode !== "calculated") {
    return NextResponse.json({ error: "defaultShippingMode must be 'free' or 'calculated'" }, { status: 400 });
  }
  if (storeDescriptionFooter !== undefined && typeof storeDescriptionFooter !== "string") {
    return NextResponse.json({ error: "storeDescriptionFooter must be a string" }, { status: 400 });
  }
  // Cap length defensively — this gets appended to every listing
  // description eBay accepts, no reason to let it grow unbounded.
  if (typeof storeDescriptionFooter === "string" && storeDescriptionFooter.length > 4000) {
    return NextResponse.json({ error: "storeDescriptionFooter is too long (max 4000 characters)" }, { status: 400 });
  }
  if (accentColor !== undefined && !ACCENT_COLORS.includes(accentColor)) {
    return NextResponse.json({ error: `accentColor must be one of: ${ACCENT_COLORS.join(", ")}` }, { status: 400 });
  }

  const payload: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  if (defaultShippingMode !== undefined) payload.default_shipping_mode = defaultShippingMode;
  if (storeDescriptionFooter !== undefined) payload.store_description_footer = storeDescriptionFooter;
  if (accentColor !== undefined) payload.accent_color = accentColor;

  const { error } = await supabase
    .from("app_settings")
    .upsert(payload, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, defaultShippingMode, storeDescriptionFooter, accentColor });
}
