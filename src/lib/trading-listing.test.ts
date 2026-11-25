import { describe, it, expect } from "vitest";
import {
  buildTradingItemXml, parseTradingResponse, duplicateUuidItemId, isInventoryModelError, isPackageError,
  listingUuid, scheduleTimeFromNow, listingPostalCode, publishApi, tradingRequestXml,
} from "@/lib/trading-listing";

const add = buildTradingItemXml({
  title: "Nike Hoodie Mens L & Co <Black>",
  descriptionHtml: "<p>Nice]]>hoodie</p>",
  categoryId: "155183",
  conditionId: 3000,
  conditionDescription: "Pre-owned in good condition.",
  aspects: { Brand: ["Nike"], Features: ["Hooded", "Pockets"], Empty: [""] },
  pictureUrls: ["https://x/1.jpg", "https://x/2.jpg"],
  price: 24.5,
  quantity: 1,
  sku: "1003",
  uuid: "ABCDEF0123456789ABCDEF0123456789",
  policies: { shippingProfileId: "111", returnProfileId: "222", paymentProfileId: null },
  package: { weightOz: 20, lengthIn: 12, widthIn: 9, heightIn: 3, packageType: "PARCEL_OR_PADDED_ENVELOPE" },
  storeCategoryId: "5",
  postalCode: "10001",
  scheduleTime: "2026-12-15T15:00:00.000Z",
  forAdd: true,
});

describe("buildTradingItemXml", () => {
  it("maps every field the Inventory path sent", () => {
    expect(add).toContain("<Title>Nike Hoodie Mens L &amp; Co &lt;Black&gt;</Title>");
    expect(add).toContain("<Description><![CDATA[<p>Nice]]]]><![CDATA[>hoodie</p>]]></Description>");
    expect(add).toContain("<PrimaryCategory><CategoryID>155183</CategoryID></PrimaryCategory>");
    expect(add).toContain("<ConditionID>3000</ConditionID><ConditionDescription>Pre-owned in good condition.</ConditionDescription>");
    expect(add).toContain("<NameValueList><Name>Features</Name><Value>Hooded</Value><Value>Pockets</Value></NameValueList>");
    expect(add).not.toContain("<Name>Empty</Name>");
    expect(add).toContain("<PictureDetails><PictureURL>https://x/1.jpg</PictureURL><PictureURL>https://x/2.jpg</PictureURL></PictureDetails>");
    expect(add).toContain('<StartPrice currencyID="USD">24.50</StartPrice><Quantity>1</Quantity><SKU>1003</SKU>');
    expect(add).toContain("<ShippingPackage>ParcelOrPaddedEnvelope</ShippingPackage><WeightMajor>1</WeightMajor><WeightMinor>4</WeightMinor>");
    expect(add).toContain("<Storefront><StoreCategoryID>5</StoreCategoryID></Storefront>");
    expect(add).toContain("<ListingDuration>GTC</ListingDuration><ListingType>FixedPriceItem</ListingType>");
    expect(add).toContain("<PostalCode>10001</PostalCode><UUID>ABCDEF0123456789ABCDEF0123456789</UUID><ScheduleTime>2026-12-15T15:00:00.000Z</ScheduleTime>");
    expect(add).toContain("<SellerProfiles><SellerShippingProfile><ShippingProfileID>111</ShippingProfileID></SellerShippingProfile><SellerReturnProfile><ReturnProfileID>222</ReturnProfileID></SellerReturnProfile></SellerProfiles>");
  });

  it("revise blocks carry the ItemID and none of the add-only fields", () => {
    const rev = buildTradingItemXml({ itemId: "123456789012", title: "T", descriptionHtml: "", price: 10 });
    expect(rev).toBe('<Item><ItemID>123456789012</ItemID><Title>T</Title><StartPrice currencyID="USD">10.00</StartPrice></Item>');
    expect(tradingRequestXml("ReviseFixedPriceItem", rev)).toContain("<ReviseFixedPriceItemRequest");
  });

  it("never sends a condition description for new items", () => {
    expect(buildTradingItemXml({ title: "T", descriptionHtml: "", conditionId: 1000, conditionDescription: "x" })).not.toContain("ConditionDescription");
  });
});

describe("parseTradingResponse", () => {
  it("reads success, item ID, fees and warnings", () => {
    const r = parseTradingResponse(`<AddFixedPriceItemResponse><Ack>Warning</Ack><ItemID>256789012345</ItemID><StartTime>2026-11-24T10:00:00.000Z</StartTime>
      <Fees><Fee><Name>InsertionFee</Name><Fee currencyID="USD">0.0</Fee></Fee><Fee><Name>ListingFee</Name><Fee currencyID="USD">0.35</Fee></Fee></Fees>
      <Errors><ShortMessage>Heads up</ShortMessage><LongMessage>Item specifics &amp; more</LongMessage><ErrorCode>21919303</ErrorCode><SeverityCode>Warning</SeverityCode></Errors></AddFixedPriceItemResponse>`);
    expect(r.ok).toBe(true);
    expect(r.itemId).toBe("256789012345");
    expect(r.warnings[0].long).toBe("Item specifics & more");
    expect(r.errors).toEqual([]);
  });

  it("recovers the existing listing on a duplicate UUID (error 488)", () => {
    const r = parseTradingResponse(`<R><Ack>Failure</Ack><Errors><ShortMessage>Duplicate UUID used.</ShortMessage><LongMessage>The UUID has already been used; ItemID 110040602158.</LongMessage><ErrorCode>488</ErrorCode><SeverityCode>Error</SeverityCode><ErrorParameters ParamID="0"><Value>ABC</Value></ErrorParameters><ErrorParameters ParamID="1"><Value>110040602158</Value></ErrorParameters></Errors></R>`);
    expect(r.ok).toBe(false);
    expect(duplicateUuidItemId(r)).toBe("110040602158");
  });

  it("spots Inventory-API listings and package errors", () => {
    const inv = parseTradingResponse(`<R><Ack>Failure</Ack><Errors><ShortMessage>Inventory-based listing management is not currently supported by this tool.</ShortMessage><ErrorCode>21919474</ErrorCode><SeverityCode>Error</SeverityCode></Errors></R>`);
    expect(isInventoryModelError(inv)).toBe(true);
    const pkg = parseTradingResponse(`<R><Ack>Failure</Ack><Errors><ShortMessage>Invalid ShippingPackage.</ShortMessage><ErrorCode>1</ErrorCode><SeverityCode>Error</SeverityCode></Errors></R>`);
    expect(isPackageError(pkg)).toBe(true);
  });
});

describe("helpers", () => {
  it("UUIDs: stable per draft and round, 32 hex", () => {
    expect(listingUuid("d1", null)).toMatch(/^[0-9A-F]{32}$/);
    expect(listingUuid("d1", null)).toBe(listingUuid("d1", undefined));
    expect(listingUuid("d1", "123")).not.toBe(listingUuid("d1", null));
  });
  it("schedule time, postal code, publish API flag", () => {
    expect(scheduleTimeFromNow(21, Date.parse("2026-11-24T10:37:12Z"))).toBe("2026-12-15T10:00:00.000Z");
    expect(listingPostalCode({ EBAY_ITEM_LOCATION: "Brooklyn, NY 11201" })).toBe("11201");
    expect(listingPostalCode({})).toBe("33125");
    expect(publishApi({})).toBe("trading");
    expect(publishApi({ PUBLISH_API: "Inventory" })).toBe("inventory");
  });
});
