// Every eBay Trading API call Listflow makes, with eBay's lifecycle status.
// Checked against https://developer.ebay.com/develop/get-started/api-deprecation-status
// and the Trading API release notes on 2026-11-25. The test next to this
// file fails if code starts using a Trading call that isn't listed here,
// or if a listed call's decommission date gets close -- so a shutdown can't
// sneak up on the app.
//
// As of 2026-11-25 NONE of the calls below is deprecated. GetMyeBaySelling
// is not on eBay's deprecation list; eBay's Modern APIs Migration Guide
// names the GraphQL Listing API `sellerListingSearch` as its eventual
// replacement (see NOTES.md, "eBay API migration" for the plan and why it
// isn't switched yet).
export type CallStatus = "supported" | "deprecated";

export interface TradingCallInfo {
  status: CallStatus;
  /** eBay's announced decommission date (YYYY-MM-DD), if any. */
  decommission: string | null;
  /** What eBay's migration guide says replaces it. */
  replacement: string;
  usedFor: string;
}

export const CHECKED_ON = "2026-11-25";

export const TRADING_CALLS: Record<string, TradingCallInfo> = {
  AddFixedPriceItem: { status: "supported", decommission: null, replacement: "Listing API createListing (GraphQL)", usedFor: "publish" },
  VerifyAddFixedPriceItem: { status: "supported", decommission: null, replacement: "Listing API createListing with options VALIDATE", usedFor: "Check with eBay (dry run)" },
  ReviseFixedPriceItem: { status: "supported", decommission: null, replacement: "Listing API updateListing", usedFor: "edit in place, price changes, store category" },
  RelistFixedPriceItem: { status: "supported", decommission: null, replacement: "Listing API relistListing", usedFor: "relist ended" },
  EndItem: { status: "supported", decommission: null, replacement: "Listing API endListing", usedFor: "delist" },
  GetItem: { status: "supported", decommission: null, replacement: "Listing API sellerListings", usedFor: "two-way sync, import, thumbnails" },
  GetMyeBaySelling: { status: "supported", decommission: null, replacement: "Listing API sellerListingSearch", usedFor: "Live / Ended / Scheduled lists, Home counts" },
  GetSellerEvents: { status: "supported", decommission: null, replacement: "Listing API sellerListingSearch (modifiedAtRange)", usedFor: "background sync" },
  GetSellerTransactions: { status: "supported", decommission: null, replacement: "Fulfillment API getOrders / Order API orders", usedFor: "Sales, Ship, Home" },
  GetBestOffers: { status: "supported", decommission: null, replacement: "Offer API sellerNegotiationHistory", usedFor: "Offers" },
  RespondToBestOffer: { status: "supported", decommission: null, replacement: "Offer API acceptOffer / counterOffer / declineOffer", usedFor: "Offers" },
  GetMemberMessages: { status: "supported", decommission: null, replacement: "Message API getConversations", usedFor: "Buyer questions" },
  AddMemberMessageRTQ: { status: "supported", decommission: null, replacement: "Message API sendMessage", usedFor: "Reply to buyer questions" },
  GetUser: { status: "supported", decommission: null, replacement: "Identity API getUser", usedFor: "account-deletion matching" },
  GetStore: { status: "supported", decommission: null, replacement: "Stores API getStore", usedFor: "store categories" },
};

/** Trading calls eBay has deprecated that Listflow must never start using. */
export const KNOWN_DEPRECATED: Record<string, string> = {
  GetOrders: "2027-06-30 (use Fulfillment API getOrders)",
  CompleteSale: "2027-06-30 (Order / Fulfillment / Feedback APIs)",
  GeteBayDetails: "2027-06-30 (Metadata API)",
  SetShippingDiscountProfiles: "2027-01-30 (Account API v2 combined shipping rules)",
  GetShippingDiscountProfiles: "2027-01-30 (Account API v2 combined shipping rules)",
  UploadSiteHostedPictures: "decommissioned 2026-09-30 (Media API)",
  GetCategoryFeatures: "decommissioned 2026-06-04 (Metadata API)",
  GetCategories: "decommissioned 2026-04-15 (Taxonomy API)",
  GetCategoryMappings: "decommissioned 2025-06-02 (Taxonomy API)",
};

const DAY_MS = 86_400_000;

/** Calls whose shutdown is within `days` (or past) -- should be empty. */
export function callsNearShutdown(now = Date.now(), days = 180): string[] {
  return Object.entries(TRADING_CALLS)
    .filter(([, i]) => i.decommission && Date.parse(i.decommission) - now < days * DAY_MS)
    .map(([name]) => name);
}
