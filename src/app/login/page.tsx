"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Loader2 } from "lucide-react";

// Sign-up is intentionally NOT offered from this page. Listflow has no
// per-user data isolation — every signed-in account sees the same shared
// drafts, listings, and connected eBay store (see CLAUDE.md's Supabase
// section). An open "Create account" link here would let any stranger who
// finds this URL sign up and get full read/write access to real eBay
// listings, sales history, and buyer shipping addresses. The two existing
// accounts were created directly in the Supabase dashboard; if a new one
// is ever needed, create it there rather than reopening self-serve signup
// on this page. This is a UI-level mitigation only — the authoritative
// fix is disabling "Allow new users to sign up" in the Supabase dashboard
// (Authentication -> Sign In / Providers -> Email), since that's enforced
// by Supabase itself and can't be bypassed by calling its API directly
// with the public anon key the way an app-level check here could be.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Brute-force protection: check whether this email is currently
    // locked out (5+ failed attempts within the last 15 minutes) before
    // even trying the password. Runs as a narrow Postgres RPC — see the
    // add_login_lockout_protection migration. Fails open on error: an RPC
    // hiccup shouldn't lock a real user out of trying to sign in.
    const { data: lockoutData } = await supabase.rpc("check_login_lockout", { p_email: email });
    const lockout = lockoutData?.[0] as { locked: boolean; seconds_remaining: number } | undefined;
    if (lockout?.locked) {
      const minutes = Math.ceil(lockout.seconds_remaining / 60);
      setError(`Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      await supabase.rpc("record_failed_login", { p_email: email });
      setError(error.message);
      setLoading(false);
    } else {
      await supabase.rpc("clear_login_attempts", { p_email: email });
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
      </div>
    </main>
  );
}
