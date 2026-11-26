import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { billingEnabled, createPortalSession, isTestKey, stripeEnv } from "@/lib/billing/stripe";

export const runtime = "nodejs";

// Stripe's customer portal (change plan / seats, cancel, card). TEST MODE only.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  if (!billingEnabled() || !isTestKey(process.env.STRIPE_SECRET_KEY)) return NextResponse.json({ error: "Plans aren't switched on yet." }, { status: 404 });
  const { data } = await auth.supabase.from("billing_subscriptions").select("stripe_customer_id").eq("user_id", auth.user.id).maybeSingle();
  if (!data?.stripe_customer_id) return NextResponse.json({ error: "No subscription yet." }, { status: 400 });
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
    const s = await createPortalSession(stripeEnv(), data.stripe_customer_id, `${origin}/membership`);
    return NextResponse.json({ url: s.url });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
