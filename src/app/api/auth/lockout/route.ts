import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// Good enough to keep obviously-garbage input out of login_attempts without
// trying to be a full email validator — Supabase Auth itself is the real
// validator for whether an email is a real account.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(value);
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  // Service-role client: bypasses RLS entirely, never exposed to the
  // browser (this file only ever runs server-side). persistSession/
  // autoRefreshToken are off since this is a one-shot per-request client,
  // not a long-lived session.
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Proxies the three login-lockout RPCs (check_login_lockout,
// record_failed_login, clear_login_attempts — see
// supabase-migrations/005_login_lockout_protection.sql) so they're callable
// from the browser's pre-auth login flow without those RPCs themselves
// needing to stay grantable to `anon` (see 006_lock_down_login_rpcs.sql for
// why that was a real problem — anyone could call them directly against
// Supabase's public REST RPC endpoint with no rate limiting at all).
//
// This route IS intentionally reachable before sign-in (see
// middleware.ts's PUBLIC_PREFIXES) — that's the point, since a signed-out
// visitor is exactly who needs to check/record a login attempt. It's not
// "public" in the sense of doing anything sensitive: the only thing it
// touches is the login_attempts bookkeeping table, gated by email-shape
// validation here and the app's general rate limit in middleware.ts, same
// as every other endpoint gets.
export async function POST(req: NextRequest) {
  let body: { action?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { action, email } = body;
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }
  if (action !== "check" && action !== "record" && action !== "clear") {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  let supabase;
  try {
    supabase = serviceClient();
  } catch (err) {
    // Same "warn, don't block" pattern as Upstash rate limiting elsewhere
    // in this app (see middleware.ts): fail OPEN rather than let a missing
    // secondary-protection secret take down every sign-in. Logged so a
    // missing SUPABASE_SERVICE_ROLE_KEY is visible in Vercel's logs instead
    // of silently disabling lockout protection forever.
    console.error("[auth/lockout] misconfigured:", (err as Error).message);
    return NextResponse.json(
      action === "check" ? { result: { locked: false, seconds_remaining: 0 } } : { ok: true }
    );
  }

  if (action === "check") {
    const { data, error } = await supabase.rpc("check_login_lockout", { p_email: email });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ result: data?.[0] ?? { locked: false, seconds_remaining: 0 } });
  }

  if (action === "record") {
    const { error } = await supabase.rpc("record_failed_login", { p_email: email });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // action === "clear"
  const { error } = await supabase.rpc("clear_login_attempts", { p_email: email });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
