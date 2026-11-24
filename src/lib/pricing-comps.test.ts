import { describe, it, expect } from "vitest";
import { compsFromBrowse, compQuery } from "@/lib/pricing-comps";

describe("pricing comps", () => {
  it("reads Browse item summaries incl. shipping and condition", () => {
    const comps = compsFromBrowse({
      itemSummaries: [
        { title: "A", price: { value: "20.00" }, conditionId: "3000", itemWebUrl: "u1", shippingOptions: [{ shippingCost: { value: "0.00" } }] },
        { title: "B", price: { value: "15" }, shippingOptions: [{ shippingCostType: "CALCULATED" }] },
        { title: "", price: { value: "5" } },
      ],
    });
    expect(comps).toEqual([
      { title: "A", price: 20, shipping: 0, conditionId: "3000", url: "u1" },
      { title: "B", price: 15, shipping: null, conditionId: null, url: null },
    ]);
  });
  it("builds a short query with the brand in front", () => {
    expect(compQuery("Vintage Fleece Jacket Mens Medium Green Zip Pockets", "Patagonia")).toBe("Patagonia Vintage Fleece Jacket Mens Medium Green");
    expect(compQuery("Patagonia Fleece", "Patagonia")).toBe("Patagonia Fleece");
    expect(compQuery("Tee", "Unknown")).toBe("Tee");
  });
});
