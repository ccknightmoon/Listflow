import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ACCOUNT_DELETION_GRACE_PERIOD_DAYS, purgeDateFrom } from "@/lib/account-deletion";

export const runtime = "nodejs";

// Powers both the Settings "Delete account" section (to show nothing extra
// when there's no pending request) and /account/pending-deletion (to show
// the countdown). Kept as its own tiny endpoint rather than folding into
// GET /api/settings so the pending-deletion page -- which middleware lets
// through even while every other route is blocked -- has exactly one thing
// it needs to call.
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;

  const { data } = await supabase
    .from("app_settings")
    .select("deletion_requested_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const deletionRequestedAt = data?.deletion_requested_at ?? null;
  if (!deletionRequestedAt) {
    return NextResponse.json({ pending: false });
  }

  const purgeAt = purgeDateFrom(deletionRequestedAt);
  const daysRemaining = Math.max(
    0,
    Math.ceil((purgeAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  );

  return NextResponse.json({
    pending: true,
    deletionRequestedAt,
    purgeAt: purgeAt.toISOString(),
    daysRemaining,
    gracePeriodDays: ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
  });
}
