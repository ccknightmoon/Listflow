import { tradingRequest } from "@/lib/ebay-inventory";
import { xmlFind, xmlFindAll } from "@/lib/ebay-listings";

// Moved out of api/ebay/ship/route.ts so the daily-digest cron
// (src/app/api/cron/daily-digest/route.ts) can get an unshipped-orders
// count as a direct function call instead of duplicating the "paid but not
// shipped" transaction-parsing logic a second time. Deliberately does NOT
// include ship/route.ts's own thumbnail-enrichment step (Supabase lookup +
// per-item GetItem fallback calls) -- that only matters for what the Ship
// page renders, not for a digest count, and keeping it out of here keeps
// this function cheap to call from the cron for every connected user.
// ship/route.ts calls this first, then layers its own thumbnail lookups
// on top of whatever this returns.
//
// xmlFind/xmlFindAll used to be a third local copy of these regex helpers
// (ebay-listings.ts's own header comment already exists to stop that
// pattern -- offers/route.ts and ebay-messages.ts had the same
// duplication, cleaned up earlier); reusing the shared versions here too.

export interface ShippingAddress {
  name: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
}

export interface UnshippedOrder {
  listingId: string;
  transactionId: string;
  title: string;
  price: number;
  qty: number;
  total: number;
  paidAt: string;
  address: ShippingAddress | null;
  galleryUrl: string | null;
}

export interface FetchUnshippedOrdersResult {
  items: UnshippedOrder[];
  error?: string;
  connect?: boolean;
  reconnect?: boolean;
}

export async function fetchUnshippedOrders(): Promise<FetchUnshippedOrdersResult> {
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();

  const result = await tradingRequest(
    "GetSellerTransactions",
    `<?xml version="1.0" encoding="utf-8"?><GetSellerTransactionsRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DetailLevel>ReturnAll</DetailLevel><ModTimeFrom>${from}</ModTimeFrom><ModTimeTo>${to}</ModTimeTo><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination></GetSellerTransactionsRequest>`
  );

  if (!result.body.includes("<Ack>Success</Ack>")) {
    const errMsg = xmlFind(result.body, "LongMessage") || xmlFind(result.body, "ShortMessage") || "eBay API error";
    // "Not connected" is already checked up front via requireEbayConnection()
    // before this ever runs.
    const isAuth = errMsg.toLowerCase().includes("auth") || errMsg.toLowerCase().includes("token") || errMsg.toLowerCase().includes("permission");
    return { items: [], error: errMsg, connect: false, reconnect: isAuth };
  }

  const txBlocks = xmlFindAll(result.body, "Transaction");

  const items = txBlocks
    .map((tx) => {
      const paidTime = xmlFind(tx, "PaidTime");
      const shippedTime = xmlFind(tx, "ShippedTime");

      // Only items that have been paid but not yet shipped
      if (!paidTime || shippedTime) return null;

      const itemBlock = xmlFind(tx, "Item");
      const listingId = xmlFind(itemBlock, "ItemID");
      const title = xmlFind(itemBlock, "Title") || xmlFind(tx, "Title");
      const transactionId = xmlFind(tx, "TransactionID");
      const price = parseFloat(xmlFind(tx, "TransactionPrice") || "0");
      const qty = parseInt(xmlFind(tx, "QuantityPurchased") || "1", 10);
      const pictureDetails = xmlFind(itemBlock, "PictureDetails");
      const galleryUrl = xmlFind(pictureDetails, "GalleryURL") || xmlFind(itemBlock, "GalleryURL") || null;

      const buyerBlock = xmlFind(tx, "Buyer");
      const buyerInfoBlock = xmlFind(buyerBlock, "BuyerInfo");
      const addrBlock = xmlFind(buyerInfoBlock, "ShippingAddress");

      const addrName = xmlFind(addrBlock, "Name");
      const street1 = xmlFind(addrBlock, "Street1");
      const street2 = xmlFind(addrBlock, "Street2");
      const city = xmlFind(addrBlock, "CityName");
      const state = xmlFind(addrBlock, "StateOrProvince");
      const zip = xmlFind(addrBlock, "PostalCode");

      const address = (city || state || zip)
        ? { name: addrName, street1, street2, city, state, zip }
        : null;

      return {
        listingId,
        transactionId,
        title,
        price,
        qty,
        total: price * qty,
        paidAt: paidTime,
        address,
        galleryUrl,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return { items };
}
