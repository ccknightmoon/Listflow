import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { parseStorageBody, storageFromRow, STORAGE_DEFAULTS } from "@/lib/storage-locations";

export const runtime = "nodejs";

// Settings → "Storage & pick list" (app_settings.storage_settings,
// migration 041). Missing column -> { available: false } and the feature
// stays OFF everywhere.
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { data, error } = await auth.supabase.from("app_settings").select("storage_settings").eq("user_id", auth.user.id).maybeSingle();
  if (error) return NextResponse.json({ available: false, settings: STORAGE_DEFAULTS });
  return NextResponse.json({ available: true, settings: storageFromRow((data as { storage_settings?: unknown } | null)?.storage_settings) });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const body = await req.json().catch(() => null);
  const parsed = parseStorageBody(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { error } = await auth.supabase.from("app_settings").upsert({ user_id: auth.user.id, storage_settings: parsed.value }, { onConflict: "user_id" });
  if (error) {
    const pending = /storage_settings/.test(error.message ?? "") || error.code === "PGRST204" || error.code === "42703";
    return NextResponse.json({ error: pending ? "This needs a one-time database update (migration 041)." : "Couldn't save.", needsMigration: pending }, { status: pending ? 409 : 500 });
  }
  return NextResponse.json({ ok: true, settings: parsed.value });
}
