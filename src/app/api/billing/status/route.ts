import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getEntitlements } from "@/lib/billing/entitlements";
import { billingEnabled, missingStripeConfig } from "@/lib/billing/stripe";
import { PLANS, PLAN_ORDER, SEAT_PRICE_USD } from "@/lib/billing/plans";

export const runtime = "nodejs";

// Plan + what's allowed, for the Membership page. With billing off this
// always says "unlimited" (nothing changes for anyone).
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const ent = await getEntitlements(auth.user.id);
  let hasCustomer = false;
  if (billingEnabled()) {
    const { data } = await auth.supabase.from("billing_subscriptions").select("stripe_customer_id, status, current_period_end").eq("user_id", auth.user.id).maybeSingle();
    hasCustomer = !!data?.stripe_customer_id;
  }
  return NextResponse.json(
    {
      entitlements: ent,
      plans: PLAN_ORDER.map((id) => PLANS[id]),
      seatPriceUsd: SEAT_PRICE_USD,
      testMode: true,
      checkoutReady: billingEnabled() && missingStripeConfig().length === 0,
      hasCustomer,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
