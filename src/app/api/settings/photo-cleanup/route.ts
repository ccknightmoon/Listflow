import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

// Photo storage cleanup settings (migration 030). Separate from
// /api/settings so a missing migration can't break the main settings page.
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { data, error } = await auth.supabase
    .from("app_settings")
    .select("photo_cleanup_enabled, photo_cleanup_days, photo_cleanup_orphans, photo_cleanup_last_run")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ available: false });
  return NextResponse.json({
    available: true,
    enabled: data?.photo_cleanup_enabled ?? true,
    days: data?.photo_cleanup_days ?? 3,
    orphans: data?.photo_cleanup_orphans ?? false,
    lastRun: data?.photo_cleanup_last_run ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown; days?: unknown; orphans?: unknown };
  const patch: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") patch.photo_cleanup_enabled = body.enabled;
  if (typeof body.orphans === "boolean") patch.photo_cleanup_orphans = body.orphans;
  if (body.days !== undefined) {
    const d = Math.trunc(Number(body.days));
    if (!Number.isFinite(d) || d < 1 || d > 90) return NextResponse.json({ error: "Days must be 1–90." }, { status: 400 });
    patch.photo_cleanup_days = d;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  const { error } = await auth.supabase.from("app_settings").upsert({ user_id: auth.user.id, ...patch }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
