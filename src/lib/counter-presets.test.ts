import { describe, it, expect } from "vitest";
import { counterPresets } from "./counter-presets";

describe("counter-offer presets", () => {
  it("offers -5%, -10% and halfway, highest first, all between offer and ask", () => {
    expect(counterPresets(40, 25)).toEqual([
      { label: "−5%", price: 38 },
      { label: "−10%", price: 36 },
      { label: "Meet halfway", price: 32.5 },
    ]);
  });
  it("drops presets at or below the buyer's offer", () => {
    expect(counterPresets(40, 37).map((p) => p.label)).toEqual(["Meet halfway", "−5%"]); // 38.50, 38.00
  });
  it("exact cents, no duplicates, nothing when there's no room", () => {
    expect(counterPresets(19.99, 15).map((p) => p.price)).toEqual([18.99, 17.99, 17.5]);
    expect(counterPresets(10, 9.99)).toEqual([]);
    expect(counterPresets(null, 5)).toEqual([]);
  });
});
