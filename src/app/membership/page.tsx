"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Feather, Rocket, Building2, Check, Loader2, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { MAX_SEATS, monthlyTotalUsd, PLANS, PLAN_ORDER, SEAT_PRICE_USD, type Entitlements, type Plan, type PlanId } from "@/lib/billing/plans";

// Plans (Nov 2026): Free (manual listing), Pro $29, Power Seller $59, plus
// helper seats. Stripe TEST MODE only, and only when billing is switched on
// (BILLING_ENABLED=1 / NEXT_PUBLIC_BILLING_ENABLED=1). With billing off this
// page just says everything is included -- nothing changes for anyone.
interface Status {
  entitlements: Entitlements;
  plans: Plan[];
  seatPriceUsd: number;
  testMode: boolean;
  checkoutReady: boolean;
  hasCustomer: boolean;
}

const ICONS: Record<PlanId, React.ElementType> = { free: Feather, pro: Rocket, power: Building2 };

export default function MembershipPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [seats, setSeats] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("checkout");
    if (q === "success") setNotice("Thanks! Your plan updates in a few seconds (Stripe test mode).");
    if (q === "cancelled") setNotice("Checkout cancelled. Nothing was charged.");
    apiFetch<Status>("/api/billing/status").then(setStatus).catch((e) => setError((e as Error).message));
  }, []);

  async function go(path: string, body?: unknown) {
    setBusy(path);
    setError(null);
    try {
      const r = await apiFetch<{ url?: string; error?: string }>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      if (r.url) window.location.assign(r.url);
      else throw new Error(r.error ?? "Stripe didn't answer.");
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const ent = status?.entitlements;
  const billingOn = !!ent?.billingEnabled;
  const current: PlanId | null = ent && !ent.unlimited ? ent.plan : null;

  return (
    <main className="min-h-screen max-w-md lg:max-w-4xl mx-auto px-5 lg:px-8 pt-6 lg:pt-8 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/settings" aria-label="Back to Settings">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-medium">Plans</h1>
      </div>

      {!status && !error && <Loader2 className="w-5 h-5 animate-spin" />}
      {notice && <div className="card p-3 mb-4 text-sm">{notice}</div>}
      {error && <div className="card p-3 mb-4 text-sm" style={{ color: "var(--danger)" }}>{error}</div>}

      {ent && (
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          {!billingOn
            ? "Plans aren't switched on. Everything is included for your account."
            : ent.unlimited
              ? "Your account has everything included."
              : `You're on ${PLANS[ent.plan].name}${ent.seats ? ` with ${ent.seats} helper seat${ent.seats === 1 ? "" : "s"}` : ""}.`}
          {billingOn && status?.testMode && " Stripe test mode: use card 4242 4242 4242 4242, no real charges."}
        </p>
      )}

      {status && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {PLAN_ORDER.map((id) => {
              const p = PLANS[id];
              const Icon = ICONS[id];
              const isCurrent = current === id;
              const canBuy = billingOn && !ent?.unlimited && status.checkoutReady && id !== "free" && !isCurrent;
              return (
                <div key={id} className="card p-5 relative" style={id === "pro" ? { border: "2px solid var(--accent)" } : undefined}>
                  <Icon className="w-5 h-5" style={{ color: id === "pro" ? "var(--accent)" : "var(--text-secondary)" }} />
                  <h3 className="text-base font-medium mt-3">{p.name}</h3>
                  <p className="text-2xl font-medium mt-1">
                    ${p.priceUsd}
                    <span className="text-sm text-[var(--text-secondary)] font-normal">/mo</span>
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mb-3">{p.blurb}</p>
                  <ul className="flex flex-col gap-2 mb-5">
                    {p.bullets.map((b) => (
                      <li key={b} className="text-sm flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--success)" }} />
                        {b}
                      </li>
                    ))}
                  </ul>
                  {isCurrent ? (
                    <p className="text-sm font-medium text-center">Current plan</p>
                  ) : canBuy ? (
                    <button className={id === "pro" ? "btn btn-primary w-full" : "btn w-full"} disabled={!!busy} onClick={() => void go("/api/billing/checkout", { plan: id, seats })}>
                      {busy === "/api/billing/checkout" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Choose {p.name} · ${monthlyTotalUsd(id, seats)}/mo
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="card p-5 mt-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4" />
              <h3 className="text-base font-medium">Helper seats</h3>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              ${status.seatPriceUsd || SEAT_PRICE_USD}/mo per helper on Pro or Power Seller.
            </p>
            {billingOn && !ent?.unlimited && !status.hasCustomer && (
              <label className="text-sm flex items-center gap-3">
                Helpers
                <input type="number" min={0} max={MAX_SEATS} value={seats} onChange={(e) => setSeats(Math.max(0, Math.min(MAX_SEATS, Math.trunc(Number(e.target.value)) || 0)))} className="input w-20" />
              </label>
            )}
            {billingOn && status.hasCustomer && (
              <button className="btn mt-2" disabled={!!busy} onClick={() => void go("/api/billing/portal")}>
                {busy === "/api/billing/portal" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Manage plan, seats or card
              </button>
            )}
          </div>
        </>
      )}
    </main>
  );
}
