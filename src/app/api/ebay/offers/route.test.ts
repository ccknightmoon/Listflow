import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { state, trading } = vi.hoisted(() => ({
  state: { user: { id: "u1" } as { id: string } | null, connected: true },
  trading: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: async () =>
    state.user
      ? { user: state.user, supabase: {}, unauthorized: null }
      : { user: null, supabase: {}, unauthorized: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) },
}));
vi.mock("@/lib/ebay-connection", () => ({
  requireEbayConnection: async () => (state.connected ? { userId: state.user?.id ?? "u1", ebayUserId: "seller", refreshToken: "x", policies: {} } : null),
}));
vi.mock("@/lib/ebay-inventory", async (orig) => ({
  ...(await orig<typeof import("@/lib/ebay-inventory")>()),
  tradingRequest: (call: string, xml: string) => trading(call, xml),
}));

import { GET } from "@/app/api/ebay/offers/route";

// 450 active listings (3 pages of 200 in GetMyeBaySelling).
const LISTINGS = Array.from({ length: 450 }, (_, i) => String(100000000000 + i));
const activePage = (page: number) => {
  const ids = LISTINGS.slice((page - 1) * 200, page * 200);
  return `<GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList><ItemArray>${ids
    .map((id) => `<Item><ItemID>${id}</ItemID><Title>Item ${id}</Title><BuyItNowPrice>30.00</BuyItNowPrice><SellingStatus><CurrentPrice>30.00</CurrentPrice></SellingStatus><PictureDetails><GalleryURL>https://img/${id}.jpg</GalleryURL></PictureDetails></Item>`)
    .join("")}</ItemArray><PaginationResult><TotalNumberOfPages>3</TotalNumberOfPages><TotalNumberOfEntries>450</TotalNumberOfEntries></PaginationResult></ActiveList></GetMyeBaySellingResponse>`;
};
// Pending offers on listings far past the old 60-listing cap.
const OFFER_ITEMS = [LISTINGS[5], LISTINGS[150], LISTINGS[399], LISTINGS[449]];
const bestOffersPage = (page: number) => {
  const items = page === 1 ? OFFER_ITEMS.slice(0, 2) : OFFER_ITEMS.slice(2);
  return `<GetBestOffersResponse><Ack>Success</Ack><ItemBestOffersArray>${items
    .map((id) => `<ItemBestOffers><BestOfferArray><BestOffer><BestOfferID>bo-${id}</BestOfferID><Buyer><UserID>b${id}</UserID></Buyer><Price>20.00</Price><Status>Pending</Status><Quantity>1</Quantity></BestOffer></BestOfferArray><Item><ItemID>${id}</ItemID></Item></ItemBestOffers>`)
    .join("")}</ItemBestOffersArray><PaginationResult><TotalNumberOfPages>2</TotalNumberOfPages></PaginationResult></GetBestOffersResponse>`;
};
const pageOf = (xml: string) => parseInt(xml.match(/<PageNumber>(\d+)<\/PageNumber>/)?.[1] ?? "1", 10);

beforeEach(() => {
  state.user = { id: `u${Math.random()}` }; // fresh user → no cross-test listings cache
  state.connected = true;
  trading.mockReset();
});

describe("GET /api/ebay/offers", () => {
  it("rejects signed-out callers", async () => {
    state.user = null;
    expect((await GET()).status).toBe(401);
  });

  it("asks to connect when eBay isn't connected", async () => {
    state.connected = false;
    expect(await (await GET()).json()).toMatchObject({ connect: true });
  });

  it("finds pending offers on every listing, not just the first 60", async () => {
    trading.mockImplementation(async (call: string, xml: string) => {
      if (call === "GetMyeBaySelling") return { status: 200, body: activePage(pageOf(xml)) };
      if (call === "GetBestOffers") {
        expect(xml).not.toContain("<ItemID>"); // seller-wide, not per listing
        return { status: 200, body: bestOffersPage(pageOf(xml)) };
      }
      throw new Error(`unexpected ${call}`);
    });
    const data = await (await GET()).json();
    expect(data.truncated).toBe(false);
    expect(data.listingsChecked).toBe(450);
    expect(data.offers.map((o: { itemId: string }) => o.itemId)).toEqual(OFFER_ITEMS);
    expect(data.offers[3]).toMatchObject({ title: `Item ${LISTINGS[449]}`, thumbnail: `https://img/${LISTINGS[449]}.jpg`, askingPrice: 30, offerPrice: 20 });
    expect(trading.mock.calls.filter(([c]) => c === "GetBestOffers")).toHaveLength(2);
  });

  it("falls back to per-listing lookups (flagged as partial) if eBay refuses the seller-wide call", async () => {
    trading.mockImplementation(async (call: string, xml: string) => {
      if (call === "GetMyeBaySelling") return { status: 200, body: activePage(pageOf(xml)) };
      if (call === "GetBestOffers") {
        if (!xml.includes("<ItemID>")) return { status: 200, body: "<Ack>Failure</Ack><ShortMessage>nope</ShortMessage>" };
        return { status: 200, body: "<GetBestOffersResponse><Ack>Success</Ack></GetBestOffersResponse>" };
      }
      throw new Error(`unexpected ${call}`);
    });
    const data = await (await GET()).json();
    expect(data.truncated).toBe(true);
    expect(data.listingsChecked).toBe(60);
  });
});
