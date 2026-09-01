import { NextRequest, NextResponse } from "next/server";
import { inventoryRequest } from "@/lib/ebay-inventory";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";

export const runtime = "nodejs";

// Lets a connected seller pick their real eBay Business Policies from a
// live list — same "AI/app suggests, seller picks from what's actually
// theirs" pattern already used for Store Categories
// (src/lib/ebay-store-categories.ts) — instead of hand-typing policy IDs.
//
// Only fulfillment (shipping) and return policies are fetched. Payment
// policies are deliberately NOT fetched: buildListingPolicies() in
// ebay-inventory.ts never sends a paymentPolicyId, because EBAY_US is a
// Managed Payments marketplace where eBay ignores/rejects a seller-supplied
// one — there's nothing here that would consume that data.
//
// Flagged: exact eBay Account API field names below are not verified
// against a live account this session (no live eBay credentials available
// here) — spot-check the first time this runs against a real connected
// seller, same caveat this codebase already carries elsewhere for
// untested-against-live-eBay code.

interface FulfillmentPolicy {
  fulfillmentPolicyId: string;
  name: string;
  marketplaceId?: string;
}
interface ReturnPolicy {
  returnPolicyId: string;
  name: string;
  marketplaceId?: string;
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ connect: true, fulfillmentPolicies: [], returnPolicies: [], selected: null });
  }

  return ebayContext.run(connection, async () => {
    try {
      const [fulfillmentRes, returnRes] = await Promise.all([
        inventoryRequest("GET", "/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US"),
        inventoryRequest("GET", "/sell/account/v1/return_policy?marketplace_id=EBAY_US"),
      ]);

      if (fulfillmentRes.status >= 400 || returnRes.status >= 400) {
        const errData = (fulfillmentRes.status >= 400 ? fulfillmentRes.data : returnRes.data) as {
          errors?: Array<{ message?: string }>;
        };
        return NextResponse.json(
          { error: errData.errors?.[0]?.message ?? "Couldn't load your eBay Business Policies.", fulfillmentPolicies: [], returnPolicies: [] },
          { status: 502 }
        );
      }

      const fulfillmentPolicies = ((fulfillmentRes.data as { fulfillmentPolicies?: FulfillmentPolicy[] }).fulfillmentPolicies ?? [])
        .map((p) => ({ id: p.fulfillmentPolicyId, name: p.name }));
      const returnPolicies = ((returnRes.data as { returnPolicies?: ReturnPolicy[] }).returnPolicies ?? [])
        .map((p) => ({ id: p.returnPolicyId, name: p.name }));

      return NextResponse.json({
        fulfillmentPolicies,
        returnPolicies,
        // Empty on both means the seller hasn't set up Business Policies in
        // Seller Hub yet — the frontend shows a "set these up on eBay
        // first" message instead of an empty, confusing dropdown.
        needsSetup: fulfillmentPolicies.length === 0 && returnPolicies.length === 0,
        selected: connection.policies,
      });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message, fulfillmentPolicies: [], returnPolicies: [] }, { status: 500 });
    }
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  let body: {
    shippingFreeId?: string | null;
    shippingHeavyId?: string | null;
    shippingCalculatedId?: string | null;
    returnPolicyId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from("ebay_connections")
    .update({
      shipping_free_policy_id: body.shippingFreeId ?? null,
      shipping_heavy_policy_id: body.shippingHeavyId ?? null,
      shipping_calculated_policy_id: body.shippingCalculatedId ?? null,
      return_policy_id: body.returnPolicyId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", auth.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
