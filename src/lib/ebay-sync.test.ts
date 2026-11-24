import { describe, it, expect } from "vitest";
import { decideSync, hasLocalEdits, parseSellerEventIds, fieldsFromEbay } from "@/lib/ebay-sync";
import type { LiveItem } from "@/lib/ebay-item";

const base = { id: "d", ebay_listing_id: "256000000001", ebay_revision_hash: "A".repeat(32), ebay_synced_at: "2026-11-24T10:00:00.000Z", updated_at: "2026-11-24T10:00:01.000Z" };

describe("decideSync", () => {
  it("in sync when nothing changed on eBay", () => expect(decideSync(base, base.ebay_revision_hash, true)).toBe("in-sync"));
  it("takes eBay's version when only eBay changed", () => expect(decideSync(base, "B".repeat(32), true)).toBe("updated"));
  it("conflict when both changed", () => {
    const edited = { ...base, updated_at: "2026-11-24T10:05:00.000Z" };
    expect(hasLocalEdits(edited)).toBe(true);
    expect(decideSync(edited, "B".repeat(32), true)).toBe("conflict");
  });
  it("baseline on first sync, untracked before migration 034", () => {
    expect(decideSync({ ...base, ebay_revision_hash: null }, "B".repeat(32), true)).toBe("baseline");
    expect(decideSync(base, "B".repeat(32), false)).toBe("untracked");
  });
});

describe("GetSellerEvents", () => {
  it("reads changed item numbers", () => {
    const xml = "<R><Ack>Success</Ack><ItemArray><Item><ItemID>256000000001</ItemID></Item><Item><ItemID>256000000002</ItemID></Item><Item><ItemID>256000000001</ItemID></Item></ItemArray></R>";
    expect(parseSellerEventIds(xml)).toEqual(["256000000001", "256000000002"]);
    expect(parseSellerEventIds("<R><Ack>Failure</Ack></R>")).toBeNull();
  });
});

describe("fieldsFromEbay", () => {
  it("never touches Listflow-only fields", () => {
    const live = { itemId: "1", title: "T", descriptionHtml: "<p>x</p>", price: 9, quantity: 1, quantitySold: 0, sku: "9", conditionId: 1000, conditionName: "New with tags", conditionDescription: null, categoryId: "1", categoryName: "A", specifics: {}, pictures: [], storeCategoryId: null, status: "Active", startTime: null, endTime: null, watchCount: 0, inventoryModel: false } as LiveItem;
    const f = fieldsFromEbay(live) as Record<string, unknown>;
    expect(f).not.toHaveProperty("custom_sku");
    expect(f).not.toHaveProperty("cost_basis");
    expect(f).not.toHaveProperty("ebay_listing_id");
    expect(f.suggested_price).toBe(9);
  });
});
