"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AlertTriangle, Loader2, RotateCcw, LogOut } from "lucide-react";

interface Status {
  pending: boolean;
  daysRemaining?: number;
  purgeAt?: string;
}

// Middleware routes any signed-in user with a pending deletion request to
// this page and nowhere else in the app (see PENDING_DELETION_ALLOWED_PATHS
// in middleware.ts) until they either reactivate here or the grace period
// in src/lib/account-deletion.ts runs out and the daily purge cron deletes
// the account for good.
export default function PendingDeletionPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [reactivating, setReactivating] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/account/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setError("Could not load your account status."));
  }, []);

  async function handleReactivate() {
    if (reactivating) return;
    setReactivating(true);
    setError(null);
    try {
      const res = await fetch("/api/account/reactivate", { method: "POST" });
      if (!res.ok) throw new Error();
      window.location.href = "/dashboard";
    } catch {
      setError("Couldn't reactivate your account -- please try again.");
      setReactivating(false);
    }
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    );
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <main className="min-h-screen max-w-md mx-auto px-5 pt-16 pb-24 flex flex-col items-center text-center">
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center mb-5"
        style={{ background: "var(--warning-bg)" }}
      >
        <AlertTriangle className="w-7 h-7" style={{ color: "var(--warning-border)" }} />
      </div>

      <h1 className="text-xl font-semibold mb-2">Your account is scheduled for deletion</h1>

      {!status ? (
        <Loader2 className="w-5 h-5 mt-4 animate-spin text-[var(--text-secondary)]" />
      ) : (
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
          {status.daysRemaining !== undefined && status.daysRemaining > 0
            ? `In ${status.daysRemaining} day${status.daysRemaining === 1 ? "" : "s"}, your drafts, photos, eBay connection, and settings will be permanently deleted. Reactivate now to keep everything.`
            : "Your account is about to be permanently deleted. Reactivate now to keep everything."}
        </p>
      )}

      {error && (
        <p className="text-xs mb-4" style={{ color: "var(--danger)" }}>{error}</p>
      )}

      <button
        onClick={handleReactivate}
        disabled={reactivating || !status}
        className="btn btn-primary w-full flex items-center justify-center gap-2 mb-3"
      >
        {reactivating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
        Reactivate my account
      </button>

      <button
        onClick={handleSignOut}
        disabled={signingOut}
        className="btn w-full flex items-center justify-center gap-2"
      >
        {signingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
        Sign out
      </button>
    </main>
  );
}
