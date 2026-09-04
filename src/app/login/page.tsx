"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Loader2 } from "lucide-react";
import Link from "next/link";

// Sign-up is intentionally NOT offered from this page. Drafts, settings,
// and photos are now genuinely private per account (see the multi-tenant
// isolation migration in CLAUDE.md's Supabase section) — but every user
// still lists through the ONE connected eBay store (that's the Phase 2
// work: per-user eBay OAuth, not yet built). An open "Create account" link
// here would let any stranger who finds this URL sign up and start listing
// items into the real owner's actual eBay store. The two existing accounts
// were created directly in the Supabase dashboard; if a new one is ever
// needed before Phase 2 ships, create it there rather than reopening
// self-serve signup on this page. This is a UI-level mitigation only — the
// authoritative fix is disabling "Allow new users to sign up" in the
// Supabase dashboard (Authentication -> Sign In / Providers -> Email),
// since that's enforced by Supabase itself and can't be bypassed by
// calling its API directly with the public anon key the way an app-level
// check here could be.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoized so typing in the email/password fields (a re-render on every
  // keystroke) doesn't construct a brand new client instance each time.
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
      ),
    []
  );

  // Proxies to /api/auth/lockout instead of calling the Postgres RPCs
  // directly (the way this used to work) — those RPCs are no longer
  // callable with the public anon key at all (see
  // supabase-migrations/006_lock_down_login_rpcs.sql): calling them
  // directly let anyone hit Supabase's public REST RPC endpoint with zero
  // rate limiting, including to lock a real user out by spamming
  // record_failed_login for their email. Routing through the app's own API
  // instead means every call goes through src/middleware.ts's rate
  // limiting like everything else. Fails open on a network/parse error,
  // same as before: an infra hiccup here shouldn't lock a real user out of
  // trying to sign in.
  async function callLockout(action: "check" | "record" | "clear", emailValue: string) {
    try {
      const res = await fetch("/api/auth/lockout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email: emailValue }),
      });
      return await res.json();
    } catch {
      return null;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Brute-force protection: check whether this email is currently
    // locked out (5+ failed attempts within the last 15 minutes) before
    // even trying the password.
    const checkResult = await callLockout("check", email);
    const lockout = checkResult?.result as { locked: boolean; seconds_remaining: number } | undefined;
    if (lockout?.locked) {
      const minutes = Math.ceil(lockout.seconds_remaining / 60);
      setError(`Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      await callLockout("record", email);
      setError(error.message);
      setLoading(false);
    } else {
      await callLockout("clear", email);
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="card w-full max-w-sm p-6">
        <h2 className="text-lg font-medium mb-1">Welcome to Listflow</h2>
        <p className="text-sm text-[var(--text-secondary)] mb-6">Sign in to start listing.</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 mb-4">
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          {error && (
            <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>
          )}
          <button type="submit" disabled={loading} className="btn btn-primary w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="text-xs text-center text-[var(--text-tertiary)]">
          By signing in, you agree to our{" "}
          <Link href="/terms" className="underline">Terms</Link> and{" "}
          <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </div>
    </main>
  );
}
