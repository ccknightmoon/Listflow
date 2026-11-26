// Minimal Stripe client (fetch, no SDK) -- TEST MODE ONLY. Server only.
//
// Hard rule from Sel: no live charges. Any key that isn't a test key
// (sk_test_ / rk_test_) is refused before a request is made, so a live key
// pasted by mistake can't charge anyone.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PlanId } from "@/lib/billing/plans";

export class StripeConfigError extends Error {}

export function billingEnabled(): boolean {
  return process.env.BILLING_ENABLED === "1";
}

export function isTestKey(key: string | undefined): boolean {
  return !!key && /^(sk|rk)_test_[A-Za-z0-9]+/.test(key);
}

export interface StripeEnv {
  secretKey: string;
  webhookSecret: string | null;
  prices: { pro?: string; power?: string; seat?: string };
}

/** What's missing for test-mode billing (empty = ready). */
export function missingStripeConfig(env: Record<string, string | undefined> = process.env): string[] {
  const miss: string[] = [];
  if (!env.STRIPE_SECRET_KEY) miss.push("STRIPE_SECRET_KEY (sk_test_…)");
  else if (!isTestKey(env.STRIPE_SECRET_KEY)) miss.push("STRIPE_SECRET_KEY must be a TEST key (sk_test_…) -- live keys are refused");
  if (!env.STRIPE_WEBHOOK_SECRET) miss.push("STRIPE_WEBHOOK_SECRET (whsec_…)");
  if (!env.STRIPE_PRICE_PRO) miss.push("STRIPE_PRICE_PRO (price_… for $29/mo)");
  if (!env.STRIPE_PRICE_POWER) miss.push("STRIPE_PRICE_POWER (price_… for $59/mo)");
  if (!env.STRIPE_PRICE_SEAT) miss.push("STRIPE_PRICE_SEAT (price_… per helper seat / mo)");
  return miss;
}

export function stripeEnv(env: Record<string, string | undefined> = process.env): StripeEnv {
  const key = env.STRIPE_SECRET_KEY;
  if (!isTestKey(key)) throw new StripeConfigError("Stripe is test-mode only: STRIPE_SECRET_KEY must start with sk_test_.");
  return { secretKey: key!, webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null, prices: { pro: env.STRIPE_PRICE_PRO, power: env.STRIPE_PRICE_POWER, seat: env.STRIPE_PRICE_SEAT } };
}

/** Stripe's form encoding (nested keys like line_items[0][price]). */
export function formEncode(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => parts.push(typeof item === "object" ? formEncode(item as Record<string, unknown>, `${key}[${i}]`) : `${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`));
    else if (typeof v === "object") parts.push(formEncode(v as Record<string, unknown>, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.filter(Boolean).join("&");
}

async function stripePost<T>(env: StripeEnv, path: string, body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<T> {
  if (!isTestKey(env.secretKey)) throw new StripeConfigError("Refusing a non-test Stripe key.");
  const res = await fetchImpl(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: formEncode(body),
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Stripe ${res.status}`);
  return data;
}

export async function createCheckoutSession(env: StripeEnv, args: { userId: string; email?: string | null; customerId?: string | null; plan: PlanId; lineItems: Array<{ price: string; quantity: number }>; origin: string }, fetchImpl?: typeof fetch): Promise<{ id: string; url: string }> {
  return stripePost(env, "/v1/checkout/sessions", {
    mode: "subscription",
    line_items: args.lineItems,
    success_url: `${args.origin}/membership?checkout=success`,
    cancel_url: `${args.origin}/membership?checkout=cancelled`,
    client_reference_id: args.userId,
    customer: args.customerId ?? undefined,
    customer_email: args.customerId ? undefined : args.email ?? undefined,
    allow_promotion_codes: true,
    metadata: { user_id: args.userId, plan: args.plan },
    subscription_data: { metadata: { user_id: args.userId, plan: args.plan } },
  }, fetchImpl);
}

export async function createPortalSession(env: StripeEnv, customerId: string, returnUrl: string, fetchImpl?: typeof fetch): Promise<{ url: string }> {
  return stripePost(env, "/v1/billing_portal/sessions", { customer: customerId, return_url: returnUrl }, fetchImpl);
}

/** Verifies a Stripe-Signature header (v1 HMAC-SHA256 of `${t}.${payload}`). */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]).filter((p) => p.length === 2)) as Record<string, string>;
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

export interface StripeSubscriptionLike {
  id: string;
  customer: string;
  status: string;
  current_period_end?: number;
  livemode?: boolean;
  metadata?: Record<string, string>;
  items?: { data?: Array<{ price?: { id?: string }; quantity?: number; current_period_end?: number }> };
}

/** Map a Stripe subscription to Listflow's plan + seats by its price ids. */
export function subscriptionToRow(sub: StripeSubscriptionLike, prices: StripeEnv["prices"]): { plan: PlanId; seats: number; status: string; currentPeriodEnd: string | null } {
  const items = sub.items?.data ?? [];
  const has = (id?: string) => !!id && items.some((i) => i.price?.id === id);
  const plan: PlanId = has(prices.power) ? "power" : has(prices.pro) ? "pro" : ((sub.metadata?.plan as PlanId) === "power" || (sub.metadata?.plan as PlanId) === "pro" ? (sub.metadata!.plan as PlanId) : "free");
  const seats = items.filter((i) => prices.seat && i.price?.id === prices.seat).reduce((n, i) => n + (i.quantity ?? 0), 0);
  const end = sub.current_period_end ?? items[0]?.current_period_end;
  return { plan, seats, status: sub.status, currentPeriodEnd: end ? new Date(end * 1000).toISOString() : null };
}
