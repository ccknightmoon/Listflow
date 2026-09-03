// Phase 3 spending safety net: caps how many OpenAI vision/text calls a
// single account can make per calendar month. This is what makes it safe to
// ever open self-service sign-up (see CLAUDE.md's "No self-service sign-up"
// note) -- without it, one bad-faith account could run up real OpenAI
// charges with nothing to stop it. Enforced via a SECURITY DEFINER Postgres
// function (supabase-migrations/010_ai_usage_cap.sql), locked down to
// service_role only -- same pattern as the login-lockout RPCs in 006/007,
// so it can't be called or spoofed directly from the browser.
//
// 400/month is a starting point: generous enough that a real reseller doing
// a big batch-upload day (dozens of items) never notices it, while still
// putting a hard ceiling on a single account's worst-case monthly OpenAI
// bill. Adjust this constant once real usage patterns are visible in
// OpenAI's own usage dashboard -- no migration needed to change it.
import { createClient } from "@supabase/supabase-js";

export const MONTHLY_AI_CALL_LIMIT = 400;

export const AI_USAGE_LIMIT_MESSAGE =
  "You've reached this month's AI usage limit. It resets on the 1st.";

export interface UsageCheckResult {
  allowed: boolean;
  remaining: number;
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

/**
 * Atomically checks whether `userId` has room for `amount` more AI calls
 * this month and, if so, consumes them. Call this BEFORE making the actual
 * OpenAI request, not after -- a request that never happens shouldn't be
 * paid for or counted.
 *
 * Fails open (allowed: true) if the check itself errors, so a Supabase
 * hiccup degrades to "no cap enforced this request" rather than taking
 * down every AI feature in the app -- the same fail-open choice already
 * made for rate limiting when Upstash env vars are unset (see
 * src/middleware.ts).
 */
export async function checkAndConsumeAiUsage(
  userId: string,
  amount = 1
): Promise<UsageCheckResult> {
  try {
    const supabase = serviceClient();
    const { data, error } = await supabase.rpc("check_and_consume_ai_usage", {
      p_user_id: userId,
      p_amount: amount,
      p_monthly_limit: MONTHLY_AI_CALL_LIMIT,
    });

    const row = Array.isArray(data) ? data[0] : data;

    if (error || !row) {
      console.error("checkAndConsumeAiUsage RPC failed, failing open:", error);
      return { allowed: true, remaining: MONTHLY_AI_CALL_LIMIT };
    }

    return { allowed: row.allowed, remaining: row.remaining };
  } catch (err) {
    console.error("checkAndConsumeAiUsage threw, failing open:", err);
    return { allowed: true, remaining: MONTHLY_AI_CALL_LIMIT };
  }
}
