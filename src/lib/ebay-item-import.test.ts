import { describe, it, expect } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { importLiveItem } from "@/lib/ebay-item-import";
import type { LiveItem } from "@/lib/ebay-item";

const live: LiveItem = {
  itemId: "256111222333", title: "Levi's 501 Jeans 32x30", descriptionHtml: "<p>Great</p>", price: 28, quantity: 1, quantitySold: 0,
  sku: "1004", conditionId: 3000, conditionName: "Pre-owned - Good", conditionDescription: null, categoryId: "11483", categoryName: "Men:Jeans",
  specifics: { Brand: ["Levi's"] }, pictures: ["https://i.ebayimg.com/1.jpg"], storeCategoryId: null, status: "Active",
  startTime: null, endTime: null, watchCount: 0, inventoryModel: false,
};

describe("importLiveItem", () => {
  it("reuses the draft already linked to the listing", async () => {
    const fake = fakeSupabase({ drafts: { data: { id: "d-existing" } } });
    const r = await importLiveItem(fake.client as never, "u1", live.itemId, { live });
    expect(r).toMatchObject({ draftId: "d-existing", created: false });
    expect(fake.calls[0].ops).toContainEqual(["eq", ["user_id", "u1"]]);
    expect(fake.calls[0].ops).toContainEqual(["eq", ["ebay_listing_id", live.itemId]]);
  });

  it("creates a linked draft from eBay's data", async () => {
    let n = 0;
    const fake = fakeSupabase({ drafts: { data: null } });
    // first call (lookup) -> null; insert -> id
    const client = {
      from: (t: string) => {
        n++;
        return n === 2 ? fakeSupabase({ drafts: { data: { id: "d-new" } } }).client.from(t) : fake.client.from(t);
      },
    };
    const r = await importLiveItem(client as never, "u1", live.itemId, { live });
    expect(r).toMatchObject({ draftId: "d-new", created: true });
  });
});
