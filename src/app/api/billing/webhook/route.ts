import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-service";
import { billingEnabled, isTestKey, stripeEnv, verifyStripeSignature } from "@/lib/billing/stripe";
import { handleStripeEvent, type StripeEventLike } from "@/lib/billing/webhook";
import { forgetSubscription } from "@/lib/billing/entitlements";

export const runtime = "nodejs";

// Stripe -> Listflow (TEST MODE). Public route (no session); every request
// must carry a valid Stripe-Signature for STRIPE_WEBHOOK_SECRET.
export async function POST(req: NextRequest) {
  if (!billingEnabled() || !isTestKey(process.env.STRIPE_SECRET_KEY)) return NextResponse.json({ error: "Billing off" }, { status: 404 });
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }
  let event: StripeEventLike;
  try {
    event = JSON.parse(payload) as StripeEventLike;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const db = getServiceClient();
  try {
    const r = await handleStripeEvent(event, stripeEnv().prices, async (row) => {
      const { error } = await db.from("billing_subscriptions").upsert(row, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    });
    if (r.userId) forgetSubscription(r.userId);
    return NextResponse.json({ received: true, ...r });
  } catch (err) {
    // 500 so Stripe retries (e.g. migration 039 not applied yet).
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
