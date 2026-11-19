// Phase 3 spending safety net: caps how many OpenAI vision/text calls a
// single account can make per calendar month. This is what makes it safe to
// ever open self-service sign-up (see CLAUDE.md's "No self-service sign-up"
// note) -- without it, one bad-faith account could run up real OpenAI
// charges with nothing to stop it. Enforced via a SECURITY DEFINER Postgres
// function (supabase-migrations/010_ai_usage_cap.sql), locked down to
// service_role only -- same pattern as the login-lockout RPCs in 006/007,
// so it can't be called or spoofed directly from the browser.
//
// History: raised from 400 to 3,000/month after pricing this against real OpenAI
// rates: grouping now runs on gpt-4o-mini (see group-photos/route.ts), so a
// full 40-item batch-upload session costs roughly $0.15-0.20 in AI calls.
// Even a daily power user doing that every day of the month lands around
// $5-6/month in worst-case OpenAI spend -- 3,000 calls/month gives real
// headroom above normal heavy use while still capping worst-case abuse to a
// small, known dollar amount. Adjust this constant once real usage patterns
// are visible in OpenAI's own usage dashboard -- no migration needed to
// change it.
// Volume Phase 1 (PLAN-volume.md): raised 3,000 -> 10,000/month so a
// 50-item day (~80-100 counted calls) never runs out, with a daily safety
// limit on top (migration 028) and an estimated-spend alert (banner via
// GET /api/ai-usage, plus an "ai_spend_alert" log line).
import { createClient } from "@supabase/supabase-js";

export const MONTHLY_AI_CALL_LIMIT = 10_000;
/** Per-UTC-day safety limit. ~6x a heavy 50-item day. Needs migration 028. */
export const DAILY_AI_CALL_LIMIT = 600;
/**
 * Rough blended OpenAI cost per counted call (USD): analysis of a
 * multi-photo item ~$0.03, a grouping/divider call ~$0.01-0.02. An
 * estimate for the alert only -- OpenAI's usage page is the real bill.
 */
export const EST_COST_PER_CALL_USD = 0.025;
/** Estimated monthly spend that triggers the alert. Override with AI_MONTHLY_SPEND_ALERT_USD. */
export const DEFAULT_SPEND_ALERT_USD = 75;

export function spendAlertUsd(): number {
  const v = Number(process.env.AI_MONTHLY_SPEND_ALERT_USD);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_SPEND_ALERT_USD;
}

export function estimateSpendUsd(calls: number): number {
  return Math.round(calls * EST_COST_PER_CALL_USD * 100) / 100;
}

export const AI_USAGE_LIMIT_MESSAGE =
  "You've reached this month's AI usage limit. It resets on the 1st.";
export const AI_DAILY_LIMIT_MESSAGE = `You've reached today's AI safety limit (${DAILY_AI_CALL_LIMIT} calls). It resets at midnight UTC.`;

export interface UsageCheckResult {
  allowed: boolean;
  remaining: number;
  /** Which limit stopped it (only when allowed is false). */
  reason?: "month" | "day";
  /** Message to show when not allowed. */
  message: string;
  monthUsed?: number;
  dayUsed?: number;
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// Set once v2 is found missing (migration 028 not applied) so we stop
// trying it on every call in this server instance.
let v2Missing = false;

function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function|does not exist/i.test(error.message ?? "");
}

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

/** Logs once per crossing so the alert shows up in Vercel logs. */
function maybeLogSpendAlert(userId: string, before: number, after: number) {
  const threshold = spendAlertUsd();
  if (estimateSpendUsd(before) < threshold && estimateSpendUsd(after) >= threshold) {
    console.warn(JSON.stringify({ event: "ai_spend_alert", userId, estSpendUsd: estimateSpendUsd(after), thresholdUsd: threshold, calls: after }));
  }
}

/** Core logic, with the RPC injectable for tests. */
export async function checkAndConsumeWith(rpc: Rpc, userId: string, amount: number): Promise<UsageCheckResult> {
  const failOpen: UsageCheckResult = { allowed: true, remaining: MONTHLY_AI_CALL_LIMIT, message: "" };
  try {
    if (!v2Missing) {
      const { data, error } = await rpc("check_and_consume_ai_usage_v2", {
        p_user_id: userId,
        p_amount: amount,
        p_monthly_limit: MONTHLY_AI_CALL_LIMIT,
        p_daily_limit: DAILY_AI_CALL_LIMIT,
      });
      if (isMissingFunction(error)) {
        v2Missing = true;
      } else {
        const row = (Array.isArray(data) ? data[0] : data) as
          | { allowed: boolean; remaining: number; reason: "month" | "day" | null; month_used: number; day_used: number }
          | undefined;
        if (error || !row) {
          console.error("checkAndConsumeAiUsage v2 RPC failed, failing open:", error);
          return failOpen;
        }
        if (row.allowed) maybeLogSpendAlert(userId, row.month_used - amount, row.month_used);
        const reason = row.allowed ? undefined : row.reason ?? "month";
        return {
          allowed: row.allowed,
          remaining: row.remaining,
          reason,
          message: reason === "day" ? AI_DAILY_LIMIT_MESSAGE : AI_USAGE_LIMIT_MESSAGE,
          monthUsed: row.month_used,
          dayUsed: row.day_used,
        };
      }
    }

    const { data, error } = await rpc("check_and_consume_ai_usage", {
      p_user_id: userId,
      p_amount: amount,
      p_monthly_limit: MONTHLY_AI_CALL_LIMIT,
    });
    const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean; remaining: number } | undefined;
    if (error || !row) {
      console.error("checkAndConsumeAiUsage RPC failed, failing open:", error);
      return failOpen;
    }
    if (row.allowed) {
      const after = MONTHLY_AI_CALL_LIMIT - row.remaining;
      maybeLogSpendAlert(userId, after - amount, after);
    }
    return { allowed: row.allowed, remaining: row.remaining, reason: row.allowed ? undefined : "month", message: AI_USAGE_LIMIT_MESSAGE };
  } catch (err) {
    console.error("checkAndConsumeAiUsage threw, failing open:", err);
    return failOpen;
  }
}

/** Test hook: forget that v2 was missing. */
export function __resetAiUsageForTests() {
  v2Missing = false;
}

/**
 * Atomically checks whether `userId` has room for `amount` more AI calls
 * (this month AND today) and, if so, consumes them. Call this BEFORE making
 * the actual OpenAI request.
 *
 * Fails open (allowed: true) if the check itself errors, so a Supabase
 * hiccup degrades to "no cap enforced this request" rather than taking
 * down every AI feature in the app. Falls back to the monthly-only check
 * when migration 028 hasn't been applied yet.
 */
export async function checkAndConsumeAiUsage(userId: string, amount = 1): Promise<UsageCheckResult> {
  const supabase = serviceClient();
  return checkAndConsumeWith((fn, args) => supabase.rpc(fn, args), userId, amount);
}
