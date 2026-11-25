import { describe, it, expect } from "vitest";
import { checkPriceAndFloor, defaultFloorFor, bestOfferTerms, storedFloorError, parseMoneyText, withPriceCheck, moneyText } from "@/lib/offer-floor";
import { getListingReadiness } from "@/lib/listing-readiness";
import { buildTradingItemXml, isBestOfferError, type TradingResult } from "@/lib/trading-listing";
import { draftBodyError, draftRowFromBody, withoutMissingColumn } from "@/lib/draft-row";
import { draftFieldsError } from "@/lib/input-validation";

describe("checkPriceAndFloor", () => {
  it("accepts a price with a lower floor, or no floor", () => {
    expect(checkPriceAndFloor("28", "24")).toEqual({ ok: true, price: 28, floor: 24, priceError: null, floorError: null });
    expect(checkPriceAndFloor("28", "")).toMatchObject({ ok: true, price: 28, floor: null });
    expect(checkPriceAndFloor(28, null)).toMatchObject({ ok: true, floor: null });
    expect(checkPriceAndFloor("$1,299.50", "999")).toMatchObject({ ok: true, price: 1299.5, floor: 999 });
  });
  it("rejects a missing, zero or sub-$0.99 price", () => {
    expect(checkPriceAndFloor("", "").priceError).toMatch(/above \$0/);
    expect(checkPriceAndFloor("0", "").priceError).toMatch(/above \$0/);
    expect(checkPriceAndFloor("0.5", "").priceError).toMatch(/0\.99/);
    expect(checkPriceAndFloor("abc", "").ok).toBe(false);
  });
  it("rejects a floor at/above the price, zero, or under $0.99", () => {
    expect(checkPriceAndFloor("28", "28").floorError).toMatch(/lower than the price/);
    expect(checkPriceAndFloor("28", "30").floorError).toMatch(/lower than the price/);
    expect(checkPriceAndFloor("28", "0").floorError).toMatch(/leave it blank/);
    expect(checkPriceAndFloor("28", "0.5").floorError).toMatch(/0\.99/);
    expect(checkPriceAndFloor("28", ".").ok).toBe(false);
  });
  it("only reports the price error when the price itself is bad", () => {
    const c = checkPriceAndFloor("", "24");
    expect(c.priceError).toBeTruthy();
    expect(c.floorError).toBeNull();
  });
});

describe("helpers", () => {
  it("defaultFloorFor keeps only a valid AI floor", () => {
    expect(defaultFloorFor(28, 24)).toBe(24);
    expect(defaultFloorFor(28, 28)).toBeNull();
    expect(defaultFloorFor(28, undefined)).toBeNull();
    expect(defaultFloorFor(null, 24)).toBeNull();
    expect(defaultFloorFor(28, 0.5)).toBeNull();
  });
  it("parseMoneyText / moneyText", () => {
    expect(parseMoneyText("24.999")).toBe(25);
    expect(parseMoneyText("")).toBeNull();
    expect(parseMoneyText("1.2.3")).toBeNull();
    expect(moneyText(24)).toBe("24");
    expect(moneyText(null)).toBe("");
  });
  it("bestOfferTerms turns a valid floor into auto-decline", () => {
    expect(bestOfferTerms(28, 24)).toEqual({ enabled: true, autoDecline: 24 });
    expect(bestOfferTerms(28, "24.5")).toEqual({ enabled: true, autoDecline: 24.5 });
    expect(bestOfferTerms(28, null)).toEqual({ enabled: false });
    expect(bestOfferTerms(28, 28)).toEqual({ enabled: false });
  });
  it("storedFloorError", () => {
    expect(storedFloorError(28, null)).toBeNull();
    expect(storedFloorError(28, 24)).toBeNull();
    expect(storedFloorError(28, 30)).toMatch(/lower/);
    expect(storedFloorError(28, "24")).toMatch(/number/);
  });
  it("withPriceCheck blocks Ready on a bad price/floor", () => {
    const ready = { score: 100, ready: true, status: "ready" as "ready" | "needs-look", reasons: [] as { field: string; message: string; blocking: boolean; points: number }[] };
    expect(withPriceCheck(ready, checkPriceAndFloor("28", "24"))).toBe(ready);
    const bad = withPriceCheck(ready, checkPriceAndFloor("28", "30"));
    expect(bad.ready).toBe(false);
    expect(bad.status).toBe("needs-look");
    expect(bad.reasons[0]).toMatchObject({ field: "Offer floor", blocking: true });
    expect(withPriceCheck(ready, checkPriceAndFloor("", "")).reasons[0].field).toBe("Price");
  });
});

describe("listing readiness", () => {
  const base = { photoCount: 2, title: "Nike Hoodie", condition: "Good", shippingMode: "calculated" };
  it("is ready with a valid price + floor", () => {
    expect(getListingReadiness({ ...base, price: 28, bestOfferFloor: "24" }).ready).toBe(true);
    expect(getListingReadiness({ ...base, price: 28, bestOfferFloor: "" }).ready).toBe(true);
  });
  it("blocks an invalid floor or price", () => {
    expect(getListingReadiness({ ...base, price: 28, bestOfferFloor: "30" }).blockers.join()).toMatch(/offer floor/i);
    expect(getListingReadiness({ ...base, price: 0, bestOfferFloor: "" }).blockers).toContain("Set a price");
    expect(getListingReadiness({ ...base, price: 0.5 }).ready).toBe(false);
  });
});

describe("Trading XML Best Offer", () => {
  it("enables Best Offer with an auto-decline floor", () => {
    const xml = buildTradingItemXml({ title: "T", descriptionHtml: "", price: 28, bestOffer: { enabled: true, autoDecline: 24 } });
    expect(xml).toContain("<BestOfferDetails><BestOfferEnabled>true</BestOfferEnabled></BestOfferDetails>");
    expect(xml).toContain('<ListingDetails><MinimumBestOfferPrice currencyID="USD">24.00</MinimumBestOfferPrice></ListingDetails>');
    expect(xml).not.toContain("BestOfferAutoAcceptPrice");
  });
  it("supports auto-accept above the floor", () => {
    const xml = buildTradingItemXml({ title: "T", descriptionHtml: "", price: 28, bestOffer: { enabled: true, autoDecline: 20, autoAccept: 26 } });
    expect(xml).toContain('<BestOfferAutoAcceptPrice currencyID="USD">26.00</BestOfferAutoAcceptPrice>');
    expect(xml).toContain('<MinimumBestOfferPrice currencyID="USD">20.00</MinimumBestOfferPrice>');
  });
  it("never sends a floor at/above the price", () => {
    const xml = buildTradingItemXml({ title: "T", descriptionHtml: "", price: 28, bestOffer: { enabled: true, autoDecline: 28 } });
    expect(xml).not.toContain("MinimumBestOfferPrice");
  });
  it("turns it off explicitly, or leaves it alone when omitted", () => {
    expect(buildTradingItemXml({ title: "T", descriptionHtml: "", price: 28, bestOffer: { enabled: false } })).toContain("<BestOfferEnabled>false</BestOfferEnabled>");
    expect(buildTradingItemXml({ title: "T", descriptionHtml: "", price: 28 })).not.toContain("BestOffer");
  });
  it("recognizes eBay's Best Offer refusals", () => {
    const r = (msg: string): TradingResult => ({ ack: "Failure", ok: false, itemId: null, errors: [{ code: "1", severity: "Error", short: msg, long: msg, params: [] }], warnings: [], feesTotal: null, startTime: null });
    expect(isBestOfferError(r("Best Offer is not available for this category."))).toBe(true);
    expect(isBestOfferError(r("Invalid ShippingPackage"))).toBe(false);
  });
});

describe("drafts API body", () => {
  it("accepts and stores a valid floor", () => {
    expect(draftBodyError({ suggestedPrice: 28, bestOfferFloor: 24 })).toBeNull();
    expect(draftRowFromBody("u1", { suggestedPrice: 28, bestOfferFloor: 24 })).toMatchObject({ suggested_price: 28, best_offer_floor: 24 });
    expect(draftRowFromBody("u1", { suggestedPrice: 28, bestOfferFloor: null })).toMatchObject({ best_offer_floor: null });
    expect("best_offer_floor" in draftRowFromBody("u1", { suggestedPrice: 28 })).toBe(false);
  });
  it("rejects a floor at/above the price or of the wrong type", () => {
    expect(draftBodyError({ suggestedPrice: 28, bestOfferFloor: 28 })).toMatch(/lower than the price/);
    expect(draftFieldsError({ bestOfferFloor: "24" })).toMatch(/bestOfferFloor/);
  });
  it("drops a not-yet-migrated column and keeps the rest", () => {
    const row = { title: "x", best_offer_floor: 24, item_specifics: null };
    expect(withoutMissingColumn(row, { code: "PGRST204", message: "Could not find the 'best_offer_floor' column of 'drafts'" })).toEqual({ title: "x", item_specifics: null });
    expect(withoutMissingColumn(row, { code: "23505", message: "duplicate" })).toBeNull();
  });
});
