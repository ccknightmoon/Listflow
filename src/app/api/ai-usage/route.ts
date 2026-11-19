import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { DAILY_AI_CALL_LIMIT, MONTHLY_AI_CALL_LIMIT, estimateSpendUsd, spendAlertUsd } from "@/lib/ai-usage";

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

  // day_date/day_count come from migration 028; if it isn't applied yet
  // the select fails, so fall back to the monthly columns only.
  let row: { call_count: number; period_month: string; day_date?: string | null; day_count?: number } | null = null;
  let failed = false;
  {
    const withDay = await supabase
      .from("ai_usage_counters")
      .select("call_count, period_month, day_date, day_count")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!withDay.error) row = withDay.data;
    else {
      const monthOnly = await supabase
        .from("ai_usage_counters")
        .select("call_count, period_month")
        .eq("user_id", user.id)
        .maybeSingle();
      if (monthOnly.error) failed = true;
      else row = monthOnly.data;
    }
  }

  const alertUsd = spendAlertUsd();
  if (failed) {
    // Same fail-open posture as checkAndConsumeAiUsage -- a lookup hiccup
    // should just mean "no banner shown" for this purely informational
    // feature, not an error surfaced to the seller.
    return NextResponse.json({ used: 0, limit: MONTHLY_AI_CALL_LIMIT, dayUsed: 0, dailyLimit: DAILY_AI_CALL_LIMIT, estSpendUsd: 0, spendAlertUsd: alertUsd });
  }

  // A row can exist but be from a previous month/day if this account
  // hasn't made an AI call since the rollover -- the counters only reset
  // the next time an AI call actually runs. Treat stale periods as 0.
  const now = new Date().toISOString();
  const isCurrentMonth = !!row?.period_month && String(row.period_month).slice(0, 7) === now.slice(0, 7);
  const used = isCurrentMonth && row ? row.call_count : 0;
  const isToday = !!row?.day_date && String(row.day_date).slice(0, 10) === now.slice(0, 10);
  const dayUsed = isToday && row ? row.day_count ?? 0 : 0;

  return NextResponse.json({
    used,
    limit: MONTHLY_AI_CALL_LIMIT,
    dayUsed,
    dailyLimit: DAILY_AI_CALL_LIMIT,
    estSpendUsd: estimateSpendUsd(used),
    spendAlertUsd: alertUsd,
  });
}
