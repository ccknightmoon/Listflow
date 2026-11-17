// Browser-safe parts of the watcher-offer feature (no eBay/server imports).
export const OFFER_DISCOUNTS = [10, 15, 20] as const;

export function isValidOfferDiscount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 5 && n <= 80;
}

export function buildOfferBody(listingId: string, discountPercentage: number, message?: string) {
  return {
    allowCounterOffer: false,
    message: (message ?? "Thanks for your interest — here's a special price, just for you.").slice(0, 2000),
    offerDuration: { unit: "DAY", value: 2 },
    offeredItems: [{ listingId, discountPercentage: String(discountPercentage), quantity: 1 }],
  };
}
