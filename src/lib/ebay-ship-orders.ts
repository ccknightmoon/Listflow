import { tradingRequest } from "@/lib/ebay-inventory";
import { xmlFind, xmlFindAll } from "@/lib/ebay-listings";
import { decodeEntities } from "@/lib/html-entities";
import { fetchFinanceTransactions } from "@/lib/ebay-finances";
import { orderIdOf, shipState } from "@/lib/ship-status";

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
  buyerUserId?: string | null;
  orderId?: string | null;
}

export interface FetchUnshippedOrdersResult {
  items: UnshippedOrder[];
  error?: string;
  connect?: boolean;
  reconnect?: boolean;
}

const SHIP_WINDOW_DAYS = 30;
const MAX_PAGES = 10;

function txXml(from: string, to: string, page: number) {
  return `<?xml version="1.0" encoding="utf-8"?><GetSellerTransactionsRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DetailLevel>ReturnAll</DetailLevel><IncludeContainingOrder>true</IncludeContainingOrder><ModTimeFrom>${from}</ModTimeFrom><ModTimeTo>${to}</ModTimeTo><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></GetSellerTransactionsRequest>`;
}

/** Order ids that have an eBay shipping label in Finances (label bought = shipped). Empty if unavailable. */
async function ordersWithEbayLabels(): Promise<Set<string>> {
  const res = await fetchFinanceTransactions(Date.now() - 45 * 86_400_000, Date.now()).catch(() => null);
  const set = new Set<string>();
  for (const t of res?.ledger ?? []) {
    if (t.type === "SHIPPING_LABEL" && t.orderId && t.amountCents < 0) set.add(t.orderId.toUpperCase());
  }
  return set;
}

export async function fetchUnshippedOrders(): Promise<FetchUnshippedOrdersResult> {
  const from = new Date(Date.now() - SHIP_WINDOW_DAYS * 86_400_000).toISOString();
  const to = new Date().toISOString();

  // Newer schema (1225) so OrderID/ShippedTime/tracking come back on the
  // containing order too, plus every page (not just the first 200).
  const [first, labelled] = await Promise.all([
    tradingRequest("GetSellerTransactions", txXml(from, to, 1), "1225"),
    ordersWithEbayLabels(),
  ]);
  if (!first.body.includes("<Ack>Success</Ack>") && !first.body.includes("<Ack>Warning</Ack>")) {
    const errMsg = xmlFind(first.body, "LongMessage") || xmlFind(first.body, "ShortMessage") || "eBay API error";
    const isAuth = ["auth", "token", "permission", "scope"].some((w) => errMsg.toLowerCase().includes(w));
    return { items: [], error: errMsg, connect: false, reconnect: isAuth };
  }
  const pages = Math.min(parseInt(xmlFind(xmlFind(first.body, "PaginationResult"), "TotalNumberOfPages") || "1", 10) || 1, MAX_PAGES);
  const bodies = [first.body];
  if (pages > 1) {
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => tradingRequest("GetSellerTransactions", txXml(from, to, i + 2), "1225")));
    for (const r of rest) bodies.push(r.body);
  }

  const seen = new Set<string>();
  const items: UnshippedOrder[] = [];
  for (const body of bodies) {
    for (const tx of xmlFindAll(body, "Transaction")) {
      if (shipState(tx, labelled) !== "awaiting") continue;
      const itemBlock = xmlFind(tx, "Item");
      const listingId = xmlFind(itemBlock, "ItemID");
      const transactionId = xmlFind(tx, "TransactionID");
      const key = `${listingId}-${transactionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const price = parseFloat(xmlFind(tx, "TransactionPrice") || "0");
      const qty = parseInt(xmlFind(tx, "QuantityPurchased") || "1", 10) || 1;
      const pictureDetails = xmlFind(itemBlock, "PictureDetails");
      const addrBlock = xmlFind(xmlFind(xmlFind(tx, "Buyer"), "BuyerInfo"), "ShippingAddress");
      const city = xmlFind(addrBlock, "CityName"), state = xmlFind(addrBlock, "StateOrProvince"), zip = xmlFind(addrBlock, "PostalCode");
      items.push({
        listingId,
        transactionId,
        title: decodeEntities(xmlFind(itemBlock, "Title") || xmlFind(tx, "Title")),
        price,
        qty,
        total: Math.round(price * qty * 100) / 100,
        paidAt: xmlFind(tx, "PaidTime") || xmlFind(xmlFind(tx, "ContainingOrder"), "PaidTime"),
        address: city || state || zip
          ? { name: decodeEntities(xmlFind(addrBlock, "Name")), street1: decodeEntities(xmlFind(addrBlock, "Street1")), street2: decodeEntities(xmlFind(addrBlock, "Street2")), city: decodeEntities(city), state, zip }
          : null,
        galleryUrl: xmlFind(pictureDetails, "GalleryURL") || xmlFind(itemBlock, "GalleryURL") || null,
        buyerUserId: xmlFind(xmlFind(tx, "Buyer"), "UserID") || null,
        orderId: orderIdOf(tx),
      });
    }
  }
  items.sort((a, b) => Date.parse(a.paidAt) - Date.parse(b.paidAt)); // oldest (most urgent) first
  return { items };
}
