export type ListingReadinessInput = {
  photoCount: number;
  title?: string | null;
  price?: number | null;
  condition?: string | null;
  shippingMode?: string | null;
  shippingPolicyConfigured?: boolean;
};

export type ListingReadiness = {
  ready: boolean;
  blockers: string[];
  warnings: string[];
};

export function getListingReadiness(input: ListingReadinessInput): ListingReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (input.photoCount < 1) blockers.push("Add at least one photo");
  if (!input.title?.trim()) blockers.push("Add a title");
  if (input.price == null || !Number.isFinite(input.price) || input.price <= 0) {
    blockers.push("Set a price");
  }
  if (!input.condition?.trim()) blockers.push("Choose a condition");
  if (!input.shippingMode) blockers.push("Choose a shipping method");
  if (input.shippingPolicyConfigured === false) {
    blockers.push("Finish the shipping policy in eBay settings");
  }

  return { ready: blockers.length === 0, blockers, warnings };
}
