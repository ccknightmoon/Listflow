import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { MONTHLY_AI_CALL_LIMIT } from "@/lib/ai-usage";

export const runtime = "nodejs";

// Read-only usage lookup for the "you're near your monthly AI limit" nav
// banner (src/components/BottomNav.tsx). Uses the caller's OWN Supabase
// client (unlike checkAndConsumeAiUsage in src/lib/ai-usage.ts, which uses
// a service-role client) -- migration 014 grants a signed-in user SELECT
// on their own ai_usage_counters row specifically so this route can read
// without a service-role proxy. Still read-only: no policy lets a user
// write call_count, so this can't be used to spoof or reset usage.
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { supabase, user } = auth;

  const { data, error } = await supabase
    .from("ai_usage_counters")
    .select("call_count, period_month")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    // Same fail-open posture as checkAndConsumeAiUsage -- a lookup hiccup
    // should just mean "no banner shown" for this purely informational
    // feature, not an error surfaced to the seller.
    return NextResponse.json({ used: 0, limit: MONTHLY_AI_CALL_LIMIT });
  }

  // A row can exist but be from a previous calendar month if this account
  // hasn't made an AI call yet since the rollover -- check_and_consume_ai_
  // usage only rolls call_count back to 0 the next time it actually runs.
  // Treat a stale month as 0 used rather than showing last month's count.
  const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const isCurrentMonth = !!data?.period_month && String(data.period_month).slice(0, 7) === currentMonth;
  const used = isCurrentMonth && data ? data.call_count : 0;

  return NextResponse.json({ used, limit: MONTHLY_AI_CALL_LIMIT });
}
