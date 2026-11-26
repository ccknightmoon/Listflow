import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { billingEnabled, createCheckoutSession, missingStripeConfig, stripeEnv } from "@/lib/billing/stripe";
import { checkoutLineItems, type PlanId } from "@/lib/billing/plans";

export const runtime = "nodejs";

// Starts a Stripe Checkout (TEST MODE only) for Pro / Power Seller + helper seats.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  if (!billingEnabled()) return NextResponse.json({ error: "Plans aren't switched on yet." }, { status: 404 });
  const missing = missingStripeConfig();
  if (missing.length) return NextResponse.json({ error: `Stripe test mode isn't set up: ${missing.join("; ")}` }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { plan?: unknown; seats?: unknown };
  const plan = body.plan === "pro" || body.plan === "power" ? (body.plan as PlanId) : null;
  if (!plan) return NextResponse.json({ error: "Pick Pro or Power Seller." }, { status: 400 });
  const env = stripeEnv();
  const items = checkoutLineItems(plan, Number(body.seats ?? 0), env.prices);
  if (!items) return NextResponse.json({ error: "That plan isn't available." }, { status: 400 });

  const { data: existing } = await auth.supabase.from("billing_subscriptions").select("stripe_customer_id").eq("user_id", auth.user.id).maybeSingle();
  const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  try {
    const session = await createCheckoutSession(env, { userId: auth.user.id, email: auth.user.email ?? null, customerId: existing?.stripe_customer_id ?? null, plan, lineItems: items, origin });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
