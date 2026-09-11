import { describe, expect, it } from "vitest";
import { getListingReadiness } from "./listing-readiness";

describe("getListingReadiness", () => {
  it("blocks an incomplete listing", () => {
    const result = getListingReadiness({ photoCount: 0, title: "", price: null, condition: "", shippingMode: null });
    expect(result.ready).toBe(false);
    expect(result.blockers).toHaveLength(5);
  });

  it("allows optional fields to be absent", () => {
    const result = getListingReadiness({
      photoCount: 2,
      title: "Vintage jacket",
      price: 49.99,
      condition: "Good - minor flaws",
      shippingMode: "free",
    });
    expect(result).toEqual({ ready: true, blockers: [], warnings: [] });
  });

  it("blocks an explicitly missing shipping policy", () => {
    const result = getListingReadiness({
      photoCount: 1,
      title: "Shirt",
      price: 20,
      condition: "Excellent used",
      shippingMode: "calculated",
      shippingPolicyConfigured: false,
    });
    expect(result.blockers).toContain("Finish the shipping policy in eBay settings");
  });
});
