import { describe, expect, it } from "vitest";
import { autoOffersLive, minAllowedPrice, offerPriceFor, planAutoOffers, safeDiscount, settingsFromRow, AUTO_OFFER_DEFAULTS, MAX_OFFERS_PER_RUN, type OfferCandidate } from "./auto-offers";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const on = { ...AUTO_OFFER_DEFAULTS, enabled: true, percent: 15 };
const cand = (o: Partial<OfferCandidate> = {}): OfferCandidate => ({
  listingId: "111111", title: "Tee", price: 40, listedAt: "2026-11-01T00:00:00Z", draftId: "d", optIn: true, floor: 30, cost: 5, ...o,
});

describe("auto offers planner", () => {
  it("does nothing while switched off (default)", () => {
    expect(planAutoOffers(AUTO_OFFER_DEFAULTS, [cand()], new Set(["111111"]), new Map(), NOW)).toEqual({ send: [], skipped: [] });
    expect(AUTO_OFFER_DEFAULTS.enabled).toBe(false);
    expect(AUTO_OFFER_DEFAULTS.allItems).toBe(false);
  });
  it("sends the configured % when it stays above floor and cost", () => {
    const p = planAutoOffers(on, [cand()], new Set(["111111"]), new Map(), NOW);
    expect(p.send).toEqual([expect.objectContaining({ discountPercent: 15, offerPrice: 34, limitedBy: null, minAllowed: 30 })]);
  });
  it("never goes below the floor: uses a smaller %", () => {
    const p = planAutoOffers({ ...on, percent: 30 }, [cand()], new Set(["111111"]), new Map(), NOW);
    expect(p.send[0]).toMatchObject({ discountPercent: 25, offerPrice: 30, limitedBy: "floor" });
    expect(p.send[0].offerPrice).toBeGreaterThanOrEqual(30);
  });
  it("never goes below cost (cost above floor)", () => {
    const p = planAutoOffers({ ...on, percent: 50 }, [cand({ floor: 10, cost: 36 })], new Set(["111111"]), new Map(), NOW);
    expect(p.send[0]).toMatchObject({ discountPercent: 10, offerPrice: 36, limitedBy: "cost" });
  });
  it("skips when even 5% would go below the floor/cost", () => {
    const p = planAutoOffers(on, [cand({ floor: 39 })], new Set(["111111"]), new Map(), NOW);
    expect(p.send).toEqual([]);
    expect(p.skipped[0].reason).toBe("at_floor");
  });
  it("skips items with no floor and no cost", () => {
    const p = planAutoOffers(on, [cand({ floor: null, cost: null })], new Set(["111111"]), new Map(), NOW);
    expect(p.skipped[0].reason).toBe("no_floor_or_cost");
  });
  it("respects eligibility, opt-in, age and repeat window", () => {
    const e = new Set(["1", "2", "3", "4"]);
    const p = planAutoOffers(on, [
      cand({ listingId: "9" }),
      cand({ listingId: "1", optIn: false }),
      cand({ listingId: "2", listedAt: "2026-11-25T12:00:00Z" }),
      cand({ listingId: "3" }),
      cand({ listingId: "4" }),
    ], e, new Map([["3", "2026-11-22T12:00:00Z"]]), NOW);
    expect(p.skipped.map((s) => [s.listingId, s.reason])).toEqual([["9", "not_eligible"], ["1", "not_opted_in"], ["2", "too_new"], ["3", "sent_recently"]]);
    expect(p.send.map((s) => s.listingId)).toEqual(["4"]);
  });
  it("allItems includes non-opted items (still floor/cost protected)", () => {
    const p = planAutoOffers({ ...on, allItems: true }, [cand({ optIn: false })], new Set(["111111"]), new Map(), NOW);
    expect(p.send).toHaveLength(1);
  });
  it("caps one run", () => {
    const many = Array.from({ length: 80 }, (_, i) => cand({ listingId: String(100000 + i) }));
    const p = planAutoOffers(on, many, new Set(many.map((m) => m.listingId)), new Map(), NOW);
    expect(p.send).toHaveLength(MAX_OFFERS_PER_RUN);
  });
  it("math helpers", () => {
    expect(offerPriceFor(19.99, 10)).toBe(17.99);
    expect(safeDiscount(20, 10, 19)).toBe(5);
    expect(safeDiscount(20, 10, 19.5)).toBeNull();
    expect(minAllowedPrice(null, null)).toEqual({ min: 0.99, by: "minimum" });
  });
  it("settings parsing defaults to off; env switch needs exactly 1", () => {
    expect(settingsFromRow(null).enabled).toBe(false);
    expect(settingsFromRow({ auto_offers_enabled: "true" }).enabled).toBe(false);
    expect(settingsFromRow({ auto_offers_enabled: true, auto_offers_percent: 99 }).percent).toBe(10);
    expect(autoOffersLive({})).toBe(false);
    expect(autoOffersLive({ AUTO_OFFERS_ENABLED: "true" })).toBe(false);
    expect(autoOffersLive({ AUTO_OFFERS_ENABLED: "1" })).toBe(true);
  });
});
