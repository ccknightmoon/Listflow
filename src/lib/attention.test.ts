import { describe, it, expect } from "vitest";
import { attentionItems, allCaughtUp } from "./attention";

const zero = { toShip: 0, offers: 0, questions: 0, failedListings: 0, draftsNeedPhoto: 0, draftsNeedPrice: 0, stale: 0 };

describe("needs-attention inbox", () => {
  it("lists only what needs action, most urgent first", () => {
    const items = attentionItems({ ...zero, stale: 4, toShip: 2, offers: 1, draftsNeedPrice: 3 });
    expect(items.map((i) => i.key)).toEqual(["toShip", "offers", "draftsNeedPrice", "stale"]);
    expect(items[1].label).toBe("Offer waiting");
    expect(items[0].label).toBe("Orders to ship");
  });
  it("all caught up only when every count is known and zero", () => {
    expect(allCaughtUp(zero)).toBe(true);
    expect(allCaughtUp({ ...zero, offers: null })).toBeNull();
    expect(allCaughtUp({ ...zero, questions: 1 })).toBe(false);
  });
});

describe("stale deep link", () => {
  it("opens Listings filtered to stale", () => {
    const zero = { toShip: 0, offers: 0, questions: 0, failedListings: 0, draftsNeedPhoto: 0, draftsNeedPrice: 0, stale: 0 };
    expect(attentionItems({ ...zero, stale: 898 })[0].href).toBe("/store?filter=stale");
  });
});
