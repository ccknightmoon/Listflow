import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { serviceDb } from "@/lib/jobs/supabase-store";
import { previewCleanup } from "@/lib/photo-cleanup";
import { runPhotoCleanupForUser } from "@/lib/photo-cleanup-server";

export const runtime = "nodejs";

// Photo storage cleanup settings (migration 030). Separate from
// /api/settings so a missing migration can't break the main settings page.
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  // ?preview=1 -> what a cleanup would delete right now (read-only).
  if (req.nextUrl.searchParams.get("preview") === "1") {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "Preview needs the server key." }, { status: 503 });
    const preview = await previewCleanup({ db: serviceDb(), supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, ebayPictures: async () => [] }, auth.user.id);
    return NextResponse.json({ preview });
  }
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

// POST: run the cleanup now (same rules as the daily run; uses your settings).
export async function POST() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  try {
    const report = await runPhotoCleanupForUser(auth.user.id, { force: true });
    console.log(JSON.stringify({ event: "photo_cleanup", manual: true, userId: auth.user.id, ...report }));
    return NextResponse.json({ report });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
