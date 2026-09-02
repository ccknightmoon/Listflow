import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

// Starts the 30-day account-deletion grace period (see
// src/lib/account-deletion.ts). Does NOT delete anything yet -- it just
// timestamps the request so the daily purge cron can find it once the
// window has passed. The client signs the user out immediately after this
// succeeds; logging back in any time before the purge shows
// /account/pending-deletion with a one-click "Reactivate" that clears this
// same column (see api/account/reactivate).
export async function POST() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;

  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { user_id: user.id, deletion_requested_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
