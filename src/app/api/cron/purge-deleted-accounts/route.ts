import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { purgeDateFrom } from "@/lib/account-deletion";

export const runtime = "nodejs";

// Runs once a day via Vercel Cron (see vercel.json) to actually purge
// accounts whose 30-day grace period (src/lib/account-deletion.ts) has
// passed. Vercel automatically sends `Authorization: Bearer $CRON_SECRET`
// on cron-triggered requests when that env var is set -- this route
// rejects anything else, including a manual GET from a browser.
//
// Uses the service-role key (same pattern as api/auth/lockout/route.ts)
// because this has to run with no signed-in user and read/write across
// every account, not just one RLS-scoped row.
//
// Deleting the auth.users row cascades to drafts, ebay_connections, and
// app_settings for that user (all `on delete cascade` FKs, see migration
// 003) -- so the only thing this route has to clean up by hand is the
// "photos" storage bucket, which isn't FK'd to auth.users.
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function deleteUserPhotos(supabase: ReturnType<typeof getServiceClient>, userId: string) {
  const { data: files, error: listError } = await supabase.storage.from("photos").list(userId);
  if (listError || !files || files.length === 0) return;
  const paths = files.map((f) => `${userId}/${f.name}`);
  await supabase.storage.from("photos").remove(paths);
}

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = getServiceClient();

  const { data: pending, error } = await supabase
    .from("app_settings")
    .select("user_id, deletion_requested_at")
    .not("deletion_requested_at", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const due = (pending ?? []).filter(
    (row) => row.deletion_requested_at && purgeDateFrom(row.deletion_requested_at).getTime() <= now
  );

  const results: { userId: string; success: boolean; error?: string }[] = [];
  for (const row of due) {
    try {
      await deleteUserPhotos(supabase, row.user_id);
      const { error: deleteError } = await supabase.auth.admin.deleteUser(row.user_id);
      if (deleteError) throw deleteError;
      results.push({ userId: row.user_id, success: true });
    } catch (err) {
      // One account's cleanup failing (e.g. a storage hiccup) shouldn't
      // stop the rest of the batch from being processed -- it'll just be
      // picked up again on tomorrow's run since deletion_requested_at is
      // still set until auth.admin.deleteUser actually succeeds.
      results.push({ userId: row.user_id, success: false, error: String(err) });
    }
  }

  return NextResponse.json({ checked: pending?.length ?? 0, purged: results.filter((r) => r.success).length, results });
}
