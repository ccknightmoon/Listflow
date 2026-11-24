import { describe, it, expect } from "vitest";
import { parseGetItem, liveItemHash, conditionLabelFor, draftFieldsFromLiveItem } from "@/lib/ebay-item";
import { keepCustomSpecifics, isForeignHtml } from "@/lib/trading-publish";

const xml = `<GetItemResponse><Ack>Success</Ack><Item>
  <ItemID>256111222333</ItemID><Title>Levi&apos;s 501 Jeans 32x30</Title>
  <Description>&lt;p&gt;Great jeans&lt;/p&gt;</Description>
  <PrimaryCategory><CategoryID>11483</CategoryID><CategoryName>Clothing, Shoes &amp; Accessories:Men:Men&apos;s Clothing:Jeans</CategoryName></PrimaryCategory>
  <StartPrice currencyID="USD">30.0</StartPrice><Quantity>1</Quantity><SKU>1004</SKU>
  <SellingStatus><CurrentPrice currencyID="USD">28.0</CurrentPrice><QuantitySold>0</QuantitySold><ListingStatus>Active</ListingStatus></SellingStatus>
  <ConditionID>3000</ConditionID><ConditionDisplayName>Pre-owned - Good</ConditionDisplayName><ConditionDescription>Light fading.</ConditionDescription>
  <ItemSpecifics><NameValueList><Name>Brand</Name><Value>Levi&apos;s</Value></NameValueList><NameValueList><Name>Size</Name><Value>32x30</Value></NameValueList><NameValueList><Name>Seller Notes</Name><Value>Custom</Value></NameValueList></ItemSpecifics>
  <PictureDetails><PictureURL>https://i.ebayimg.com/1.jpg</PictureURL><PictureURL>https://i.ebayimg.com/2.jpg</PictureURL></PictureDetails>
  <Storefront><StoreCategoryID>7</StoreCategoryID></Storefront>
  <ListingDetails><StartTime>2026-11-01T10:00:00.000Z</StartTime><EndTime>2026-12-01T10:00:00.000Z</EndTime></ListingDetails>
  <WatchCount>3</WatchCount>
</Item></GetItemResponse>`;

describe("GetItem parsing", () => {
  const i = parseGetItem(xml)!;
  it("reads the editable fields", () => {
    expect(i).toMatchObject({ itemId: "256111222333", title: "Levi's 501 Jeans 32x30", price: 28, sku: "1004", conditionId: 3000, categoryId: "11483", storeCategoryId: "7", watchCount: 3, status: "Active" });
    expect(i.descriptionHtml).toBe("<p>Great jeans</p>");
    expect(i.specifics["Brand"]).toEqual(["Levi's"]);
    expect(i.pictures).toHaveLength(2);
  });
  it("fingerprint changes when the listing is edited", () => {
    expect(liveItemHash(i)).toBe(liveItemHash({ ...i }));
    expect(liveItemHash({ ...i, price: 27 })).not.toBe(liveItemHash(i));
  });
  it("turns into draft fields", () => {
    const d = draftFieldsFromLiveItem(i);
    expect(d).toMatchObject({ brand: "Levi's", size: "32x30", condition: "Good - minor flaws", ebay_listing_id: "256111222333", item_type: "Jeans", thumbnail_url: "https://i.ebayimg.com/1.jpg" });
    expect(isForeignHtml(d.description)).toBe(true);
  });
  it("maps condition names to Listflow labels", () => {
    expect(conditionLabelFor({ conditionId: 1000, conditionName: "New with tags" })).toBe("New with tags");
    expect(conditionLabelFor({ conditionId: 2990, conditionName: "Pre-owned - Excellent" })).toBe("Excellent used");
    expect(conditionLabelFor({ conditionId: 3010, conditionName: "Pre-owned - Fair" })).toBe("Fair - notable flaws");
  });
  it("returns null for error responses", () => {
    expect(parseGetItem("<R><Ack>Failure</Ack></R>")).toBeNull();
  });
});

describe("keepCustomSpecifics", () => {
  it("keeps custom specifics the live listing has and the draft still has", () => {
    const out = keepCustomSpecifics({ Brand: ["Levi's"] }, { Brand: ["Levi's"], "Seller Notes": ["Custom"], Gone: ["x"] }, { Brand: ["Levi's"], "Seller Notes": ["Custom"] });
    expect(out).toEqual({ Brand: ["Levi's"], "Seller Notes": ["Custom"] });
  });
});
