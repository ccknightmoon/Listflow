"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Loader2 } from "lucide-react";

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
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } else {
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
