"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Loader2 } from "lucide-react";
import Link from "next/link";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Whether Supabase has finished exchanging the recovery link for a
  // session we can call updateUser() against.
  const [ready, setReady] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
      ),
    []
  );

  useEffect(() => {
    // The recovery link lands here with either a `?code=` (this app's
    // browser clients default to the PKCE flow) or a `#access_token=`
    // fragment (implicit flow) — the client library detects and exchanges
    // it for a session automatically as soon as it's constructed
    // (detectSessionInUrl is on by default), firing a PASSWORD_RECOVERY
    // auth event on success. We deliberately wait for that instead of
    // calling exchangeCodeForSession ourselves, which would race the
    // SDK's own automatic exchange of the same one-time-use code and
    // fail one of the two calls.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });

    // Covers the case where the exchange already completed (and the
    // event already fired) before this listener was attached.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    const hasRecoveryParams =
      new URLSearchParams(window.location.search).has("code") ||
      window.location.hash.includes("access_token");

    // Give the SDK a few seconds to finish the exchange before concluding
    // the link is bad. If the URL never carried recovery params at all
    // (someone just navigated here directly), there's nothing to wait for.
    const timeout = setTimeout(() => {
      if (!hasRecoveryParams) {
        setLinkInvalid(true);
      } else {
        setReady((currentReady) => {
          if (!currentReady) setLinkInvalid(true);
          return currentReady;
        });
      }
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
      setTimeout(() => {
        router.push("/dashboard");
        router.refresh();
      }, 1200);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="card w-full max-w-sm p-6">
        <h2 className="text-lg font-medium mb-1">Set a new password</h2>

        {linkInvalid && !ready && (
          <>
            <p className="text-sm text-[var(--text-secondary)] mb-6">
              This reset link is invalid or has expired.
            </p>
            <Link href="/forgot-password" className="btn btn-primary w-full inline-flex justify-center">
              Request a new link
            </Link>
          </>
        )}

        {!linkInvalid && !ready && !success && (
          <p className="text-sm text-[var(--text-secondary)] mb-6 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Verifying your link...
          </p>
        )}

        {ready && !success && (
          <>
            <p className="text-sm text-[var(--text-secondary)] mb-6">
              Choose a new password for your account.
            </p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 mb-4">
              <input
                className="input"
                type="password"
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                minLength={8}
              />
              <input
                className="input"
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                minLength={8}
              />
              {error && (
                <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>
              )}
              <button type="submit" disabled={loading} className="btn btn-primary w-full">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loading ? "Saving..." : "Save new password"}
              </button>
            </form>
          </>
        )}

        {success && (
          <p className="text-sm" style={{ color: "var(--success)" }}>
            Password updated. Taking you to your dashboard...
          </p>
        )}
      </div>
    </main>
  );
}
