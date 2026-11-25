import { checkPriceAndFloor } from "@/lib/offer-floor";

export type ListingReadinessInput = {
  photoCount: number;
  title?: string | null;
  price?: number | null;
  condition?: string | null;
  shippingMode?: string | null;
  shippingPolicyConfigured?: boolean;
  /** eBay-required item specifics still empty for the chosen category. */
  missingRequiredSpecifics?: string[];
  /** The eBay category couldn't be confirmed, or the self-check says it's wrong. */
  categoryNeedsReview?: boolean;
  /** Self-check contradictions (title vs category vs Type vs measurements). */
  categoryIssues?: string[];
  /** Best Offer floor as typed/saved (blank/null = no offers). */
  bestOfferFloor?: string | number | null;
  /** Values eBay won't accept for list-only specifics (e.g. Size "9"). */
  invalidSpecifics?: Array<{ name: string; value: string }>;
  /** The store category clearly belongs to another kind of item. */
  storeCategoryIssue?: string | null;
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
  if (input.photoCount > 24) blockers.push("Use 24 photos or fewer");
  if (!input.title?.trim()) blockers.push("Add a title");
  if ((input.title?.trim().length ?? 0) > 80) blockers.push("Keep the title to 80 characters or fewer");
  if (input.price == null || !Number.isFinite(input.price) || input.price <= 0) {
    blockers.push("Set a price");
  } else if (input.price < 0.99) {
    blockers.push("Price must be at least $0.99");
  } else if (input.bestOfferFloor !== undefined) {
    const f = checkPriceAndFloor(input.price, input.bestOfferFloor);
    if (f.floorError) blockers.push(`Fix the offer floor: ${f.floorError}`);
  }
  if (!input.condition?.trim()) blockers.push("Choose a condition");
  if (!input.shippingMode) blockers.push("Choose a shipping method");
  if (input.missingRequiredSpecifics && input.missingRequiredSpecifics.length > 0) {
    blockers.push(`Fill eBay's required specifics: ${input.missingRequiredSpecifics.join(", ")}`);
  }
  for (const x of input.invalidSpecifics ?? []) {
    blockers.push(`Pick eBay's ${x.name} ("${x.value}" isn't on eBay's list)`);
  }
  if (input.storeCategoryIssue) blockers.push(input.storeCategoryIssue);
  if (input.categoryNeedsReview || (input.categoryIssues ?? []).some((i) => /^Category looks wrong/.test(i))) {
    blockers.push("Confirm the eBay category (it doesn't look right for this item)");
  }
  for (const i of input.categoryIssues ?? []) if (!/^Category looks wrong/.test(i)) warnings.push(i);
  if (input.shippingPolicyConfigured === false) {
    blockers.push("Finish the shipping policy in eBay settings");
  }

  return { ready: blockers.length === 0, blockers, warnings };
}
