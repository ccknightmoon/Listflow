// Stripe webhook -> billing_subscriptions row. Pure apart from the `save`
// callback, so it's unit tested. TEST MODE only: live-mode events are ignored.
import { subscriptionToRow, type StripeEnv, type StripeSubscriptionLike } from "@/lib/billing/stripe";

export interface BillingRow {
  user_id: string;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  plan?: string;
  status?: string;
  seats?: number;
  current_period_end?: string | null;
  livemode?: boolean;
  updated_at: string;
}

export interface StripeEventLike {
  id: string;
  type: string;
  livemode?: boolean;
  data: { object: Record<string, unknown> };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WebhookResult = { handled: boolean; userId?: string; reason?: string };

export async function handleStripeEvent(event: StripeEventLike, prices: StripeEnv["prices"], save: (row: BillingRow) => Promise<void>, now = new Date()): Promise<WebhookResult> {
  if (event.livemode) return { handled: false, reason: "live-mode event ignored (test mode only)" };
  const o = event.data?.object ?? {};
  const ts = now.toISOString();

  if (event.type === "checkout.session.completed") {
    const userId = String(o.client_reference_id ?? (o.metadata as Record<string, string> | undefined)?.user_id ?? "");
    if (!UUID.test(userId)) return { handled: false, reason: "no Listflow user id" };
    await save({ user_id: userId, stripe_customer_id: (o.customer as string) ?? null, stripe_subscription_id: (o.subscription as string) ?? null, livemode: false, updated_at: ts });
    return { handled: true, userId };
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = o as unknown as StripeSubscriptionLike;
    const userId = sub.metadata?.user_id ?? "";
    if (!UUID.test(userId)) return { handled: false, reason: "no Listflow user id in subscription metadata" };
    const row = subscriptionToRow(sub, prices);
    const deleted = event.type === "customer.subscription.deleted";
    await save({
      user_id: userId,
      stripe_customer_id: sub.customer,
      stripe_subscription_id: sub.id,
      plan: deleted ? "free" : row.plan,
      status: deleted ? "canceled" : row.status,
      seats: deleted ? 0 : Math.min(20, row.seats),
      current_period_end: row.currentPeriodEnd,
      livemode: false,
      updated_at: ts,
    });
    return { handled: true, userId };
  }
  return { handled: false, reason: `ignored ${event.type}` };
}
