import { describe, it, expect } from "vitest";
import { MIN_PRICE, priceFloor } from "@/lib/price-floor";

describe("priceFloor", () => {
  it("is $0.99 when cost is unknown or tiny", () => {
    expect(priceFloor(null)).toBe(MIN_PRICE);
    expect(priceFloor(undefined)).toBe(0.99);
    expect(priceFloor(0.5)).toBe(0.99);
    expect(priceFloor(NaN)).toBe(0.99);
  });
  it("uses the cost when it's above $0.99", () => {
    expect(priceFloor(4)).toBe(4);
    expect(priceFloor(3.456)).toBe(3.46);
  });
});
