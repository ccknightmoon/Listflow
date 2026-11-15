import { describe, it, expect } from "vitest";
import { buildPackageWeightAndSize, weightOunces, isShippingPackageError } from "./shipping";

const VALID_PACKAGE_TYPES = new Set([
  "LETTER", "LARGE_ENVELOPE", "PACKAGE_THICK_ENVELOPE", "PARCEL_OR_PADDED_ENVELOPE",
  "MAILING_BOX", "PADDED_BAGS", "TOUGH_BAGS", "EXTRA_LARGE_PACK", "VERY_LARGE_PACK",
]);

describe("weightOunces", () => {
  it("rounds up to whole ounces and never under-declares", () => {
    expect(weightOunces(0.7)).toBe(12); // 11.2 oz -> 12
    expect(weightOunces(1)).toBe(16);
    expect(weightOunces(1.4)).toBe(23); // 22.4 -> 23
  });
  it("does not bump an exact ounce value because of float noise", () => {
    expect(weightOunces(0.75)).toBe(12);
  });
  it("falls back to 1 oz for zero, negative or invalid input", () => {
    expect(weightOunces(0)).toBe(1);
    expect(weightOunces(-2)).toBe(1);
    expect(weightOunces(Number.NaN)).toBe(1);
  });
});

describe("buildPackageWeightAndSize", () => {
  it("builds a complete typed package for light clothing (the failing pants case)", () => {
    const pkg = buildPackageWeightAndSize("Pants", "L", "cotton");
    expect(pkg.packageType && VALID_PACKAGE_TYPES.has(pkg.packageType)).toBe(true);
    expect(pkg.weight.unit).toBe("OUNCE");
    expect(Number.isInteger(pkg.weight.value)).toBe(true);
    expect(pkg.weight.value).toBeGreaterThan(0);
    expect(pkg.dimensions.unit).toBe("INCH");
    for (const d of [pkg.dimensions.length, pkg.dimensions.width, pkg.dimensions.height]) {
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(1);
    }
  });

  it("omits packageType in the untyped variant but keeps weight and size", () => {
    const pkg = buildPackageWeightAndSize("T-Shirt", "M", null, "untyped");
    expect("packageType" in pkg).toBe(false);
    expect(pkg.weight.value).toBeGreaterThan(0);
    expect(pkg.dimensions.length).toBeGreaterThan(0);
  });

  it("still produces a valid package when item type, size and material are unknown", () => {
    const pkg = buildPackageWeightAndSize(null, null, null);
    expect(pkg.weight.value).toBeGreaterThan(0);
    expect(pkg.packageType && VALID_PACKAGE_TYPES.has(pkg.packageType)).toBe(true);
  });

  it("heavier items get a heavier weight and a box", () => {
    const tee = buildPackageWeightAndSize("T-Shirt", "M", "cotton");
    const coat = buildPackageWeightAndSize("Winter coat", "XXL", "wool");
    expect(coat.weight.value).toBeGreaterThan(tee.weight.value);
    expect(coat.packageType).toBe("MAILING_BOX");
  });
});

describe("isShippingPackageError", () => {
  it("matches eBay errorId 25101", () => {
    expect(isShippingPackageError({ errorId: 25101, message: "Invalid <ShippingPackage>." })).toBe(true);
  });
  it("matches the message even without an errorId", () => {
    expect(isShippingPackageError({ message: "Invalid <ShippingPackage>." })).toBe(true);
    expect(isShippingPackageError({ longMessage: "The package weight is not valid or is missing." })).toBe(true);
  });
  it("does not match unrelated errors", () => {
    expect(isShippingPackageError({ errorId: 25002, message: "No <Item.Currency> exists" })).toBe(false);
    expect(isShippingPackageError({ message: "Item specific Inseam is missing" })).toBe(false);
    expect(isShippingPackageError(undefined)).toBe(false);
  });
});

describe("plural item types", () => {
  it("weighs 'Pants' like 'Pant' instead of the unknown-item default", async () => {
    const { estimateWeightLb } = await import("./shipping");
    expect(estimateWeightLb("Pants", "M")).toBeCloseTo(estimateWeightLb("Pant", "M"));
    expect(estimateWeightLb("Boots", "M")).toBeCloseTo(estimateWeightLb("Boot", "M"));
    expect(estimateWeightLb("Dresses", "M")).toBeCloseTo(estimateWeightLb("Dress", "M"));
    expect(estimateWeightLb("Pants", "M")).not.toBeCloseTo(estimateWeightLb("Widget", "M"));
  });
});
