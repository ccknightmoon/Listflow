// Listflow plans (Nov 2026). Pure -- shared by server gating, the
// Membership page and tests.
//
// Billing is OFF unless BILLING_ENABLED=1 (server) / NEXT_PUBLIC_BILLING_ENABLED=1
// (screens). While it's off every account gets everything, exactly as
// before. Stripe runs in TEST MODE only (see stripe.ts).
export type PlanId = "free" | "pro" | "power";
export type Feature = "ai" | "bulk" | "sync" | "helpers";

export interface Plan {
  id: PlanId;
  name: string;
  priceUsd: number; // per month
  blurb: string;
  features: Feature[];
  bullets: string[];
}

/** Per helper seat, per month (proposal -- Sel can change it in Stripe + here). */
export const SEAT_PRICE_USD = 10;
export const MAX_SEATS = 20;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceUsd: 0,
    blurb: "List by hand",
    features: [],
    bullets: ["Unlimited manual listings", "Photos, drafts and Inventory", "Finish on eBay (scheduled hand-off)", "Sales and shipping views"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsd: 29,
    blurb: "AI + bulk + sync",
    features: ["ai", "bulk", "sync", "helpers"],
    bullets: ["Everything in Free", "AI pricing, titles and item specifics", "Bulk listing: batch upload, background batches, bulk edit", "Two-way sync with eBay every few minutes", "Add helpers (per seat)"],
  },
  power: {
    id: "power",
    name: "Power Seller",
    priceUsd: 59,
    blurb: "For high volume",
    features: ["ai", "bulk", "sync", "helpers"],
    bullets: ["Everything in Pro", "Highest AI volume", "Priority support", "Add helpers (per seat)"],
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "pro", "power"];

/** The plan that first includes a feature (for "Upgrade to Pro" messages). */
export function lowestPlanWith(feature: Feature): Plan {
  return PLANS[PLAN_ORDER.find((p) => PLANS[p].features.includes(feature)) ?? "pro"];
}

export const FEATURE_LABELS: Record<Feature, string> = {
  ai: "AI pricing and titles",
  bulk: "Bulk listing",
  sync: "Automatic sync with eBay",
  helpers: "Helper seats",
};

export function upgradeMessage(feature: Feature): string {
  const p = lowestPlanWith(feature);
  return `${FEATURE_LABELS[feature]} is part of ${p.name} ($${p.priceUsd}/mo). Upgrade in Settings → Membership.`;
}

/** Subscription states that keep paid features on (Stripe statuses). */
const ACTIVE = new Set(["active", "trialing", "past_due"]);

export interface Subscription {
  plan: PlanId;
  status: string;
  seats: number;
  currentPeriodEnd?: string | null;
}

/** The plan in force for a subscription row (anything not active = Free). */
export function effectivePlan(sub: Subscription | null | undefined): PlanId {
  if (!sub || !ACTIVE.has(sub.status)) return "free";
  return sub.plan in PLANS ? sub.plan : "free";
}

export interface Entitlements {
  /** Billing switched off: everything allowed (today's behaviour). */
  billingEnabled: boolean;
  plan: PlanId;
  /** Unlimited because billing is off or the account is exempt (owner). */
  unlimited: boolean;
  seats: number;
  can: Record<Feature, boolean>;
}

export function entitlementsFor(opts: { billingEnabled: boolean; exempt: boolean; sub: Subscription | null }): Entitlements {
  const unlimited = !opts.billingEnabled || opts.exempt;
  const plan = unlimited ? "power" : effectivePlan(opts.sub);
  const feats = new Set(PLANS[plan].features);
  const can = { ai: unlimited || feats.has("ai"), bulk: unlimited || feats.has("bulk"), sync: unlimited || feats.has("sync"), helpers: unlimited || feats.has("helpers") };
  return { billingEnabled: opts.billingEnabled, plan, unlimited, seats: unlimited ? MAX_SEATS : Math.max(0, Math.min(MAX_SEATS, opts.sub?.seats ?? 0)), can };
}

/** Stripe line items for a checkout: the plan + optional helper seats. */
export function checkoutLineItems(plan: PlanId, seats: number, prices: { pro?: string; power?: string; seat?: string }): Array<{ price: string; quantity: number }> | null {
  if (plan === "free") return null;
  const planPrice = plan === "pro" ? prices.pro : prices.power;
  if (!planPrice) return null;
  const n = Math.max(0, Math.min(MAX_SEATS, Math.trunc(seats) || 0));
  if (n > 0 && !prices.seat) return null;
  return [{ price: planPrice, quantity: 1 }, ...(n > 0 ? [{ price: prices.seat!, quantity: n }] : [])];
}

export function monthlyTotalUsd(plan: PlanId, seats: number): number {
  return PLANS[plan].priceUsd + (plan === "free" ? 0 : Math.max(0, Math.min(MAX_SEATS, seats)) * SEAT_PRICE_USD);
}
