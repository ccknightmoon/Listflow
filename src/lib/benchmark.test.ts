import { describe, it, expect } from "vitest";
import { scoreItem, aggregate, valuesAgree, sampleIds, titleScore } from "./benchmark";
import { parseGetItem } from "./benchmark-gold";

const XML = `<GetItemResponse><Ack>Success</Ack><Item><ItemID>123</ItemID><Title>Nike Dallas Cowboys Michael Irvin #88 Jersey Mens XL Navy</Title>
<PrimaryCategory><CategoryID>24511</CategoryID><CategoryName>Sports Mem, Cards &amp; Fan Shop:Fan Apparel &amp; Souvenirs:Football-NFL</CategoryName></PrimaryCategory>
<PictureDetails><PictureURL>https://i.ebayimg.com/1.jpg</PictureURL><PictureURL>https://i.ebayimg.com/2.jpg</PictureURL></PictureDetails>
<ItemSpecifics><NameValueList><Name>Brand</Name><Value>Nike</Value></NameValueList><NameValueList><Name>Team</Name><Value>Dallas Cowboys</Value></NameValueList>
<NameValueList><Name>Size</Name><Value>XL</Value></NameValueList><NameValueList><Name>Color</Name><Value>Blue</Value></NameValueList></ItemSpecifics></Item></GetItemResponse>`;

describe("benchmark", () => {
  const gold = parseGetItem(XML)!;
  it("parses Sel's listing as gold", () => {
    expect(gold).toMatchObject({ itemId: "123", categoryId: "24511", categoryPath: "Sports Mem, Cards & Fan Shop > Fan Apparel & Souvenirs > Football-NFL", pictures: ["https://i.ebayimg.com/1.jpg", "https://i.ebayimg.com/2.jpg"] });
    expect(gold.specifics).toEqual({ Brand: ["Nike"], Team: ["Dallas Cowboys"], Size: ["XL"], Color: ["Blue"] });
  });
  it("scores category, fields and title", () => {
    const s = scoreItem(gold, {
      categoryId: "24511", categoryPath: gold.categoryPath, title: "Nike Dallas Cowboys Michael Irvin #88 Men's Jersey Size XL Navy",
      specifics: { Brand: ["Nike"], Team: ["Dallas Cowboys"], Size: ["XL"], Color: ["Navy"], Player: ["Michael Irvin"] }, missingRequired: [], ready: true,
    });
    expect(s.categoryExact).toBe(true);
    expect(s.fields).toMatchObject({ Brand: "match", Team: "match", Size: "match", Color: "wrong", Player: "extra", Material: "n/a" });
    expect(s.errors).toEqual(["Color: wrong"]);
    const r = aggregate([s, { ...s, itemId: "2", categoryExact: false, categoryBranch: false, fields: { ...s.fields, Brand: "missing" }, errors: ["category: wrong branch", "Brand: missing"], ready: false }]);
    expect(r).toMatchObject({ items: 2, categoryExact: 50, categoryBranch: 50, ready: 50, readyPrecision: 0 });
    expect(r.fieldAccuracy.Brand).toEqual({ accuracy: 50, compared: 2 });
    expect(r.topErrors.map((e) => e.error)).toEqual(expect.arrayContaining(["Color: wrong", "category: wrong branch", "Brand: missing"]));
  });
  it("value agreement ignores case/punctuation/plurals and common synonyms", () => {
    expect(valuesAgree(["Men's"], ["Men"])).toBe(true);
    expect(valuesAgree(["Grey"], ["Gray"])).toBe(true);
    expect(valuesAgree(["USA"], ["United States"])).toBe(true);
    expect(valuesAgree(["Short Sleeve"], ["Long Sleeve"])).toBe(false);
  });
  it("title score and sampling", () => {
    expect(titleScore("Nike Hoodie", { Brand: ["Nike"] }).score).toBeLessThan(100);
    expect(sampleIds(Array.from({ length: 100 }, (_, i) => String(i)), 4)).toEqual(["0", "25", "50", "75"]);
  });
});
