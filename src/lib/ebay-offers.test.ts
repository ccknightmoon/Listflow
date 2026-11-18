import { describe, it, expect } from "vitest";
import { parseSellerBestOffers } from "@/lib/ebay-offers";

const offer = (id: string, status: string, price = "12.00") =>
  `<BestOffer><BestOfferID>${id}</BestOfferID><ExpirationTime>2026-11-20T10:00:00.000Z</ExpirationTime><Buyer><UserID>buyer_${id}</UserID></Buyer><Price currencyID="USD">${price}</Price><Status>${status}</Status><Quantity>1</Quantity><BuyerMessage>Would you take &amp; ship?</BuyerMessage></BestOffer>`;

const group = (itemId: string, offers: string[]) =>
  `<ItemBestOffers><BestOfferArray>${offers.join("")}</BestOfferArray><Item><ItemID>${itemId}</ItemID><Title>Vintage &amp; Co Jacket</Title><SellingStatus><CurrentPrice currencyID="USD">20.00</CurrentPrice></SellingStatus></Item></ItemBestOffers>`;

const page = (groups: string[], totalPages = 1) =>
  `<GetBestOffersResponse><Ack>Success</Ack><ItemBestOffersArray>${groups.join("")}</ItemBestOffersArray><PaginationResult><TotalNumberOfPages>${totalPages}</TotalNumberOfPages><TotalNumberOfEntries>3</TotalNumberOfEntries></PaginationResult></GetBestOffersResponse>`;

describe("parseSellerBestOffers", () => {
  it("collects pending offers across every listing in the page", () => {
    const r = parseSellerBestOffers(page([group("111", [offer("a", "Pending"), offer("b", "Declined")]), group("222", [offer("c", "Pending", "8.50")])], 3));
    expect(r.totalPages).toBe(3);
    expect(r.offers.map((o) => [o.itemId, o.bestOfferId, o.offerPrice])).toEqual([["111", "a", 12], ["222", "c", 8.5]]);
    expect(r.offers[0]).toMatchObject({ buyerUserId: "buyer_a", itemTitle: "Vintage & Co Jacket", itemPrice: 20, buyerMessage: "Would you take & ship?", quantity: 1 });
  });

  it("handles an empty response", () => {
    expect(parseSellerBestOffers("<GetBestOffersResponse><Ack>Success</Ack></GetBestOffersResponse>")).toEqual({ offers: [], totalPages: 1 });
  });

  it("accepts the single-item response shape", () => {
    const body = `<GetBestOffersResponse><Ack>Success</Ack><BestOfferArray>${offer("z", "Pending")}</BestOfferArray><Item><ItemID>333</ItemID><Title>Hat</Title></Item></GetBestOffersResponse>`;
    const r = parseSellerBestOffers(body);
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0]).toMatchObject({ itemId: "333", bestOfferId: "z", itemPrice: null });
  });
});
