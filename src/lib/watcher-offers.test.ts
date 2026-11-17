import { describe, it, expect } from "vitest";
import { buildOfferBody, isValidOfferDiscount } from "./watcher-offers-shared";

describe("offers to interested buyers", () => {
  it("builds eBay's request: no counter-offers, 2-day expiry, one item", () => {
    expect(buildOfferBody("123456789012", 15)).toMatchObject({
      allowCounterOffer: false,
      offerDuration: { unit: "DAY", value: 2 },
      offeredItems: [{ listingId: "123456789012", discountPercentage: "15", quantity: 1 }],
    });
  });
  it("only sensible whole-number discounts", () => {
    expect(isValidOfferDiscount(10)).toBe(true);
    expect(isValidOfferDiscount(4)).toBe(false);
    expect(isValidOfferDiscount(12.5)).toBe(false);
    expect(isValidOfferDiscount("10")).toBe(false);
  });
});
