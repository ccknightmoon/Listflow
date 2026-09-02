import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

// Cancels a pending deletion request -- the "log back in within the window
// to reactivate" half of the flow. Middleware only lets a user with
// deletion_requested_at set reach this route (plus /api/account/status and
// the /account/pending-deletion page itself), so reaching here at all means
// they're already past the "are you sure" step shown on that page.
export async function POST() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;

  const { error } = await supabase
    .from("app_settings")
    .update({ deletion_requested_at: null })
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
