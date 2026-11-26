// Server-side plan gating. Server only.
//
// BILLING_ENABLED unset (today): everyone is unlimited, no database read,
// nothing changes. BILLING_EXEMPT_USER_IDS: comma-separated Listflow user
// ids that stay unlimited even when billing is on (Sel's own account).
import { NextResponse } from "next/server";
import { billingEnabled } from "@/lib/billing/stripe";
import { entitlementsFor, upgradeMessage, type Entitlements, type Feature, type PlanId, type Subscription } from "@/lib/billing/plans";
import { getServiceClient } from "@/lib/supabase-service";

const cache = new Map<string, { sub: Subscription | null; until: number }>();
const TTL_MS = 60_000;

export function isExempt(userId: string, env: Record<string, string | undefined> = process.env): boolean {
  return (env.BILLING_EXEMPT_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean).includes(userId);
}

async function readSubscription(userId: string): Promise<Subscription | null> {
  const hit = cache.get(userId);
  if (hit && hit.until > Date.now()) return hit.sub;
  const { data, error } = await getServiceClient().from("billing_subscriptions").select("plan, status, seats, current_period_end").eq("user_id", userId).maybeSingle();
  // Table missing (migration 039 not applied) or a read error: Free, not cached.
  const sub = error || !data ? null : { plan: data.plan as PlanId, status: data.status as string, seats: Number(data.seats ?? 0), currentPeriodEnd: data.current_period_end as string | null };
  if (!error) {
    if (cache.size > 5000) cache.clear();
    cache.set(userId, { sub, until: Date.now() + TTL_MS });
  }
  return sub;
}

export function forgetSubscription(userId: string) {
  cache.delete(userId);
}

export async function getEntitlements(userId: string): Promise<Entitlements> {
  const enabled = billingEnabled();
  if (!enabled || isExempt(userId)) return entitlementsFor({ billingEnabled: enabled, exempt: true, sub: null });
  return entitlementsFor({ billingEnabled: true, exempt: false, sub: await readSubscription(userId) });
}

/** null = allowed; otherwise the message to show. */
export async function featureBlocked(userId: string, feature: Feature): Promise<string | null> {
  if (!billingEnabled()) return null;
  try {
    const e = await getEntitlements(userId);
    return e.can[feature] ? null : upgradeMessage(feature);
  } catch {
    return null; // fail open: a billing hiccup never takes the app down
  }
}

/** For API routes: a 402 response when the plan doesn't include `feature`, else null. */
export async function planGate(userId: string, ...features: Feature[]): Promise<NextResponse | null> {
  for (const f of features) {
    const msg = await featureBlocked(userId, f);
    if (msg) return NextResponse.json({ error: msg, upgrade: true, feature: f }, { status: 402 });
  }
  return null;
}
