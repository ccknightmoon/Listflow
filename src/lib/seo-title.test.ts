import { describe, it, expect } from "vitest";
import { seoTitle, titleIssues, deCaps } from "./seo-title";

describe("SEO titles from validated specifics", () => {
  it("Cowboys jersey: brand, team, player #, type, size, color in search order", () => {
    const t = seoTitle({ Brand: ["Nike"], Team: ["Dallas Cowboys"], Player: ["Michael Irvin"], "Jersey Number": ["88"], Product: ["Jersey"], Department: ["Men"], Size: ["XL"], Color: ["Navy"] });
    expect(t).toBe("Nike Dallas Cowboys Michael Irvin #88 Men's Jersey Size XL Navy");
    expect(titleIssues(t, { Brand: ["Nike"], Size: ["XL"] })).toEqual([]);
  });
  it("vintage/era only when evidenced; graphic tee buyer term; single stitch", () => {
    const a = { Brand: ["Hanes"], Type: ["T-Shirt"], Pattern: ["Graphic Print"], Department: ["Men"], Size: ["L"], Color: ["Black"], Theme: ["Music"] };
    expect(seoTitle(a)).toBe("Hanes Men's Graphic Tee Music Size L Black");
    expect(seoTitle(a, { vintage: true, era: "90s", singleStitch: true })).toBe("Hanes Vintage 90s Single Stitch Men's Graphic Tee Music Size L Black");
  });
  it("Carhartt jacket with model line, never over 80, no caps-lock", () => {
    const t = seoTitle({ Brand: ["CARHARTT"], Type: ["Jacket"], "Product Line": ["Detroit Jacket"], Model: ["J97"], Department: ["Men"], Size: ["XL"], Color: ["Brown"], Features: ["Blanket Lined", "Corduroy Collar", "Pockets"] });
    expect(t.length).toBeLessThanOrEqual(80);
    expect(t).toBe("Carhartt Detroit Jacket J97 Blanket Lined Corduroy Collar Men's Size XL Brown");
    expect(t).not.toMatch(/Pockets/); // weak filler feature
    expect(deCaps("CARHARTT NFL XL Y2K HOODIE")).toBe("Carhartt NFL XL Y2K Hoodie");
  });
  it("flags titles that disagree with the specifics", () => {
    expect(titleIssues("Vintage Jacket L@@K", { Brand: ["Nike"], Size: ["M"] })).toEqual([
      "Title doesn't mention the brand (Nike).", "Title doesn't show the size (M).", "Title has filler/spam words.",
    ]);
    expect(titleIssues("NIKE HOODIE Size M", { Brand: ["Nike"], Size: ["M"] })).toContain("Title has ALL-CAPS words.");
  });
});
