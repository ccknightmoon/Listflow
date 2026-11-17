import { describe, it, expect } from "vitest";
import { parseGetItem } from "./ebay-items";
import { parseMemberMessages } from "./ebay-messages";

describe("buyer messages carry their listing", () => {
  const xml = `<GetMemberMessagesResponse><Ack>Success</Ack><MemberMessage>
    <MemberMessageExchange>
      <Item><ItemID>123456789012</ItemID><Title>Levi Strauss &amp;amp; Co Jacket</Title><SellingStatus><CurrentPrice currencyID="USD">30.0</CurrentPrice></SellingStatus></Item>
      <Question><MessageID>m1</MessageID><SenderID>were-5876</SenderID><Body>Hello is 25 ok?</Body><CreationDate>2026-11-17T01:00:00Z</CreationDate></Question>
    </MemberMessageExchange>
    <MemberMessageExchange>
      <Question><MessageID>m2</MessageID><SenderID>woralux9590</SenderID><Body>Sorry for late payment</Body></Question>
    </MemberMessageExchange>
  </MemberMessage></GetMemberMessagesResponse>`;
  it("reads the Item next to each Question (not inside it)", () => {
    const qs = parseMemberMessages(xml);
    expect(qs).toHaveLength(2);
    expect(qs[0]).toMatchObject({ messageId: "m1", itemId: "123456789012", itemTitle: "Levi Strauss & Co Jacket", itemPrice: 30 });
    expect(qs[1]).toMatchObject({ messageId: "m2", itemId: null });
  });
});

describe("GetItem summary", () => {
  it("photo (gallery or first picture), decoded title, price, link", () => {
    const v = parseGetItem("99", `<Ack>Success</Ack><Item><Title>A &amp; B</Title><SellingStatus><CurrentPrice>12.5</CurrentPrice></SellingStatus><PictureDetails><PictureURL>https://i.ebayimg.com/1.jpg</PictureURL></PictureDetails></Item>`);
    expect(v).toEqual({ itemId: "99", title: "A & B", thumbnail: "https://i.ebayimg.com/1.jpg", price: 12.5, url: "https://www.ebay.com/itm/99" });
  });
  it("failure -> empty but still linkable", () => {
    expect(parseGetItem("99", "<Ack>Failure</Ack>")).toMatchObject({ title: null, thumbnail: null, price: null });
  });
});
