// Picks which of the seller's eBay shipping (fulfillment) policies a listing
// uses. Listflow lists with calculated shipping only, so the chosen policy
// MUST be one whose domestic shipping cost type is CALCULATED -- a flat-rate
// or free-shipping policy would quietly undo that.
//
// Pure function (no network) so the rules are unit-tested; the publish route
// fetches the policies and passes them in.

export interface FulfillmentPolicySummary {
  id: string;
  name: string;
  /** Domestic costType from eBay's Account API: "CALCULATED" | "FLAT_RATE" | ... */
  costType: string | null;
  /** eBay marks one policy per category group as the account default. */
  isDefault?: boolean;
}

export type PolicyChoice =
  | { ok: true; policyId: string; policyName: string; source: "saved" | "default" | "only" | "first" }
  | { ok: false; error: string };

export const NO_CALCULATED_POLICY_ERROR =
  "Your eBay account has no calculated-shipping policy, so this item can't be listed. " +
  "In eBay Seller Hub go to Account → Business policies → Create policy → Shipping, set the cost type to " +
  "\"Calculated: Cost varies by buyer location\", save it (tick \"Set as default\"), then try again.";

export function isCalculated(p: FulfillmentPolicySummary): boolean {
  return (p.costType ?? "").toUpperCase() === "CALCULATED";
}

/**
 * @param policies the account's EBAY_US fulfillment policies, or null if
 *   they couldn't be fetched (network/eBay error)
 * @param savedId the policy picked in Settings → eBay Connection, if any
 */
export function chooseCalculatedPolicy(
  policies: FulfillmentPolicySummary[] | null,
  savedId?: string | null,
): PolicyChoice {
  if (policies === null) {
    // Couldn't check the live list. Trust an explicit Settings choice;
    // without one there is nothing safe to pick.
    if (savedId) return { ok: true, policyId: savedId, policyName: "", source: "saved" };
    return { ok: false, error: "Couldn't load your eBay shipping policies to find a calculated-shipping one. Please try again in a minute." };
  }

  const calculated = policies.filter(isCalculated);
  if (calculated.length === 0) return { ok: false, error: NO_CALCULATED_POLICY_ERROR };

  const saved = savedId ? calculated.find((p) => p.id === savedId) : undefined;
  if (saved) return { ok: true, policyId: saved.id, policyName: saved.name, source: "saved" };

  const def = calculated.find((p) => p.isDefault);
  if (def) return { ok: true, policyId: def.id, policyName: def.name, source: "default" };

  if (calculated.length === 1) return { ok: true, policyId: calculated[0].id, policyName: calculated[0].name, source: "only" };

  // Several calculated policies, none marked default: deterministic pick.
  const first = [...calculated].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0];
  return { ok: true, policyId: first.id, policyName: first.name, source: "first" };
}

/** Shape eBay's Account API returns for one fulfillment policy (fields we use). */
export interface RawFulfillmentPolicy {
  fulfillmentPolicyId: string;
  name: string;
  shippingOptions?: Array<{ optionType?: string; costType?: string }>;
  categoryTypes?: Array<{ name?: string; default?: boolean }>;
}

export function summarizeFulfillmentPolicies(raw: RawFulfillmentPolicy[]): FulfillmentPolicySummary[] {
  return raw.map((p) => {
    const domestic = p.shippingOptions?.find((o) => o.optionType === "DOMESTIC") ?? p.shippingOptions?.[0];
    return {
      id: p.fulfillmentPolicyId,
      name: p.name,
      costType: domestic?.costType ?? null,
      isDefault: Boolean(p.categoryTypes?.some((c) => c.default && c.name !== "MOTORS_VEHICLES")),
    };
  });
}
