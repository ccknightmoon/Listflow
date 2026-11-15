import { describe, it, expect } from "vitest";
import {
  ITEM_TYPE_WEIGHT_TABLE, CALCULATED_PACKAGE_TYPES, MAX_PACKAGE_OZ, UNKNOWN_ITEM_PACKAGE_LB,
  buildPackageWeightAndSize, isKnownItemType, resolveWeightItemType, estimateWeightLb,
  type EbayPackageWeightAndSize,
} from "./shipping";
import {
  chooseCalculatedPolicy, summarizeFulfillmentPolicies, NO_CALCULATED_POLICY_ERROR,
  type FulfillmentPolicySummary,
} from "./calculated-policy";

const SIZES = [null, "XS", "S", "M", "L", "XL", "XXL", "4X", "32x30", "One Size"];
const MATERIALS = [null, "cotton", "wool", "leather", "denim", "polyester"];

function plural(term: string): string {
  if (term.endsWith("s")) return term;
  if (/(sh|ch|x|ss)$/.test(term)) return `${term}es`;
  return `${term}s`;
}

// Every rule eBay needs for a calculated-shipping package.
function expectValidCalculatedPackage(pkg: EbayPackageWeightAndSize, typed = true) {
  if (typed) {
    expect(CALCULATED_PACKAGE_TYPES as readonly string[]).toContain(pkg.packageType);
  } else {
    expect(pkg.packageType).toBeUndefined();
  }
  expect(pkg.weight.unit).toBe("OUNCE");
  expect(Number.isInteger(pkg.weight.value)).toBe(true);
  expect(pkg.weight.value).toBeGreaterThanOrEqual(1);
  expect(pkg.weight.value).toBeLessThanOrEqual(MAX_PACKAGE_OZ);
  expect(pkg.dimensions.unit).toBe("INCH");
  for (const d of [pkg.dimensions.length, pkg.dimensions.width, pkg.dimensions.height]) {
    expect(Number.isInteger(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(1);
    expect(d).toBeLessThanOrEqual(108);
  }
}

const ALL_TERMS = ITEM_TYPE_WEIGHT_TABLE.flatMap((row) => row.terms);

describe("calculated shipping package -- every known item type", () => {
  it("knows every term in the weight table, singular and plural", () => {
    for (const term of ALL_TERMS) {
      expect(isKnownItemType(term), term).toBe(true);
      expect(isKnownItemType(plural(term)), plural(term)).toBe(true);
    }
  });

  it.each(ALL_TERMS)("'%s' always gets a valid weight, box and package type", (term) => {
    for (const size of SIZES) {
      for (const material of MATERIALS) {
        expectValidCalculatedPackage(buildPackageWeightAndSize(term, size, material));
        expectValidCalculatedPackage(buildPackageWeightAndSize(plural(term), size, material));
        expectValidCalculatedPackage(buildPackageWeightAndSize(term, size, material, "untyped"), false);
      }
    }
  });

  it("weighs each known term by its own table row, not the unknown fallback", () => {
    for (const row of ITEM_TYPE_WEIGHT_TABLE) {
      for (const term of row.terms) {
        // Earlier rows win on overlap (e.g. "winter jacket" is a coat), so
        // compare against the weight the matcher actually resolves to.
        const pkg = buildPackageWeightAndSize(term, "M", null);
        const expectedOz = Math.ceil(Math.round(estimateWeightLb(term, "M", null) * 16 * 1000) / 1000);
        expect(pkg.weight.value, term).toBe(expectedOz);
      }
    }
  });
});

describe("calculated shipping package -- unknown items", () => {
  const unknowns = [null, undefined, "", "   ", "Widget", "Vintage Lunchbox", "Misc", "🙂", "a".repeat(500)];

  it.each(unknowns.map((u) => [String(u)]))("unknown item type %s still gets a full package", (label) => {
    const value = label === "null" ? null : label === "undefined" ? undefined : label;
    const pkg = buildPackageWeightAndSize(value, null, null);
    expectValidCalculatedPackage(pkg);
    expect(pkg.packageType).toBe("MAILING_BOX");
    expect(pkg.weight.value).toBeGreaterThanOrEqual(UNKNOWN_ITEM_PACKAGE_LB * 16);
  });

  it("uses the title when the item type is unrecognized", () => {
    expect(resolveWeightItemType("Bottoms", "Levi's 501 Jeans 32x30")).toBe("Levi's 501 Jeans 32x30");
    const fromTitle = buildPackageWeightAndSize("Bottoms", "M", null, "typed", "Levi's 501 Jeans");
    const jeans = buildPackageWeightAndSize("Jeans", "M", null);
    expect(fromTitle).toEqual(jeans);
  });

  it("prefers a recognized item type over the title", () => {
    expect(resolveWeightItemType("Coat", "Shirt jacket")).toBe("Coat");
  });

  it("falls back to the unknown box when neither type nor title is recognized", () => {
    const pkg = buildPackageWeightAndSize("Thing", null, null, "typed", "Mystery lot");
    expect(pkg.packageType).toBe("MAILING_BOX");
    expect(pkg.dimensions).toEqual({ length: 14, width: 10, height: 4, unit: "INCH" });
  });
});

describe("calculated shipping package -- batch", () => {
  it("every item in a mixed batch (all known types + unknowns) gets a valid package", () => {
    const batch = [
      ...ALL_TERMS.map((t, i) => ({ item_type: t, size: SIZES[i % SIZES.length], material: MATERIALS[i % MATERIALS.length], title: `${t} listing` })),
      { item_type: null, size: null, material: null, title: null },
      { item_type: "Widget", size: "M", material: null, title: "Mystery item" },
      { item_type: null, size: "L", material: "cotton", title: "Nike Hoodie Grey L" },
      { item_type: "Bottoms", size: "L", material: null, title: "BDG Pants Light Blue Size L" },
    ];
    const packages = batch.map((d) => buildPackageWeightAndSize(d.item_type, d.size, d.material, "typed", d.title));
    expect(packages).toHaveLength(batch.length);
    packages.forEach((p) => expectValidCalculatedPackage(p));
    // The real Sept 12 failing draft gets a pants-weight padded envelope.
    expect(packages[packages.length - 1].packageType).toBe("PARCEL_OR_PADDED_ENVELOPE");
  });
});

describe("chooseCalculatedPolicy", () => {
  const flat: FulfillmentPolicySummary = { id: "F1", name: "Free shipping", costType: "FLAT_RATE", isDefault: true };
  const calcA: FulfillmentPolicySummary = { id: "C1", name: "Calc A", costType: "CALCULATED" };
  const calcB: FulfillmentPolicySummary = { id: "C2", name: "Calc B", costType: "CALCULATED", isDefault: true };

  it("uses the Settings choice when it's a calculated policy", () => {
    expect(chooseCalculatedPolicy([flat, calcA, calcB], "C1")).toMatchObject({ ok: true, policyId: "C1", source: "saved" });
  });

  it("never uses a flat-rate/free policy even if it's saved or the account default", () => {
    const r = chooseCalculatedPolicy([flat, calcA], "F1");
    expect(r).toMatchObject({ ok: true, policyId: "C1" });
  });

  it("prefers eBay's default calculated policy when nothing valid is saved", () => {
    expect(chooseCalculatedPolicy([flat, calcA, calcB], null)).toMatchObject({ ok: true, policyId: "C2", source: "default" });
  });

  it("uses the only calculated policy", () => {
    expect(chooseCalculatedPolicy([flat, calcA], undefined)).toMatchObject({ ok: true, policyId: "C1", source: "only" });
  });

  it("picks deterministically among several non-default calculated policies", () => {
    const z = { id: "C9", name: "Zeta", costType: "CALCULATED" };
    const a = { id: "C8", name: "Alpha", costType: "CALCULATED" };
    expect(chooseCalculatedPolicy([z, a], null)).toMatchObject({ ok: true, policyId: "C8", source: "first" });
    expect(chooseCalculatedPolicy([a, z], null)).toMatchObject({ ok: true, policyId: "C8", source: "first" });
  });

  it("fails with clear setup steps when the account has no calculated policy", () => {
    expect(chooseCalculatedPolicy([flat], "F1")).toEqual({ ok: false, error: NO_CALCULATED_POLICY_ERROR });
    expect(chooseCalculatedPolicy([], null)).toEqual({ ok: false, error: NO_CALCULATED_POLICY_ERROR });
    expect(NO_CALCULATED_POLICY_ERROR).toMatch(/Business policies/);
    expect(NO_CALCULATED_POLICY_ERROR).toMatch(/Calculated/);
  });

  it("when eBay can't be reached: trusts a saved choice, otherwise asks to retry", () => {
    expect(chooseCalculatedPolicy(null, "C1")).toMatchObject({ ok: true, policyId: "C1", source: "saved" });
    const r = chooseCalculatedPolicy(null, null);
    expect(r.ok).toBe(false);
  });

  it("is case-insensitive about eBay's costType", () => {
    expect(chooseCalculatedPolicy([{ id: "c", name: "c", costType: "calculated" }], null)).toMatchObject({ ok: true, policyId: "c" });
  });
});

describe("summarizeFulfillmentPolicies", () => {
  it("reads the domestic cost type and eBay's default flag", () => {
    const out = summarizeFulfillmentPolicies([
      {
        fulfillmentPolicyId: "1", name: "Calc",
        shippingOptions: [{ optionType: "INTERNATIONAL", costType: "FLAT_RATE" }, { optionType: "DOMESTIC", costType: "CALCULATED" }],
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }],
      },
      { fulfillmentPolicyId: "2", name: "Flat", shippingOptions: [{ optionType: "DOMESTIC", costType: "FLAT_RATE" }] },
      { fulfillmentPolicyId: "3", name: "Bare" },
    ]);
    expect(out).toEqual([
      { id: "1", name: "Calc", costType: "CALCULATED", isDefault: true },
      { id: "2", name: "Flat", costType: "FLAT_RATE", isDefault: false },
      { id: "3", name: "Bare", costType: null, isDefault: false },
    ]);
  });
});
