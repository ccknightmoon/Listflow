"use client";

import { useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Loader2 } from "lucide-react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Memoized for the same reason as login/page.tsx — a fresh client on
  // every keystroke would be wasteful, not incorrect, but there's no
  // reason to pay that cost.
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
      ),
    []
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);
    // Supabase deliberately doesn't reveal whether an account exists for
    // this address (and doesn't error if it doesn't) — so the UI always
    // shows the same "check your email" state regardless, rather than
    // letting this become a way to test which emails are registered. A
    // real failure here (network hiccup, rate limit) is rare enough that
    // surfacing it plainly is still the right tradeoff over silently
    // eating it.
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="card w-full max-w-sm p-6">
        <h2 className="text-lg font-medium mb-1">Reset your password</h2>
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          {sent
            ? "If that email has an account, a reset link is on its way."
            : "Enter the email on your account and we'll send you a reset link."}
        </p>

        {!sent && (
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
            {error && (
              <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>
            )}
            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </form>
        )}

        <p className="text-xs text-center text-[var(--text-tertiary)]">
          <Link href="/login" className="underline">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
