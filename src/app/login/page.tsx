"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Loader2 } from "lucide-react";
import { checkPasswordPwned } from "@/lib/pwned-password";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupDone, setSignupDone] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );

  function switchMode(next: "signin" | "signup") {
    setMode(next);
    setError(null);
    setSignupDone(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (mode === "signin") {
      // Brute-force protection: check whether this email is currently
      // locked out (5+ failed attempts within the last 15 minutes) before
      // even trying the password. Runs as a narrow Postgres RPC — see the
      // add_login_lockout_protection migration — so it works the same way
      // whether this page or someone hitting Supabase's API directly is
      // doing the guessing... though only this page's own calls go through
      // it, since it's enforced here rather than inside Supabase's own auth
      // endpoint. Fails open on error: an RPC hiccup shouldn't lock a real
      // user out of trying to sign in.
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
    } else {
      // Free equivalent of Supabase's paid "leaked password protection"
      // toggle (that one needs a Pro-plan subscription). Fails open — if
      // the check itself can't complete (network issue, API hiccup), we
      // don't block signup over it; we only block on a confirmed match.
      const pwnedResult = await checkPasswordPwned(password);
      if (pwnedResult?.pwned) {
        setError(
          "That password has appeared in a known data breach. Please choose a different one — this protects your account even if that password is publicly known to attackers."
        );
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
      } else if (data.session) {
        // Auto-confirmed — go straight to dashboard
        router.push("/dashboard");
        router.refresh();
      } else {
        // Email confirmation required
        setSignupDone(true);
        setLoading(false);
      }
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="card w-full max-w-sm p-6">
        <h2 className="text-lg font-medium mb-1">
          {mode === "signin" ? "Welcome to Listflow" : "Create your account"}
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          {mode === "signin" ? "Sign in to start listing." : "Start listing items on eBay in minutes."}
        </p>

        {signupDone ? (
          <div className="text-center py-4">
            <p className="text-sm font-medium mb-2">Check your email</p>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.
            </p>
            <button
              className="text-sm text-brand-600"
              onClick={() => switchMode("signin")}
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <>
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
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                minLength={mode === "signup" ? 6 : undefined}
              />
              {error && (
                <p className="text-sm" style={{ color: "#B3261E" }}>{error}</p>
              )}
              <button type="submit" disabled={loading} className="btn btn-primary w-full">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loading
                  ? mode === "signin" ? "Signing in..." : "Creating account..."
                  : mode === "signin" ? "Sign in" : "Create account"}
              </button>
            </form>

            <p className="text-center text-sm text-[var(--text-secondary)]">
              {mode === "signin" ? (
                <>
                  No account?{" "}
                  <button className="text-brand-600" onClick={() => switchMode("signup")}>
                    Create one
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button className="text-brand-600" onClick={() => switchMode("signin")}>
                    Sign in
                  </button>
                </>
              )}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
