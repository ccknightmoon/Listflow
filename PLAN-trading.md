# Trading API publishing (branch `feat/trading-publish`, Nov 24, 2026)

Why: listings made with eBay's Inventory API "cannot be edited through Seller Hub or any other listing platform" (eBay's Inventory API overview), so they could never be edited in the eBay app. Trading API listings are ordinary eBay listings: editable in the eBay app and revisable from Listflow.

## Step 1: publish with the Trading API

- `PUBLISH_API=trading` (default) or `inventory` (old path, for rollback; Vercel env var, then redeploy).
- Every publish is checked with **VerifyAddFixedPriceItem** first (validates without listing), then listed with **AddFixedPriceItem** using exactly the same item. Single listing, Analyze & list, Batch, Drafts "List", "List all Ready" and the server queue all go through the same `publishDraft()`, so all switch together. Readiness checks, SKU assignment, category choice, item specifics and description are unchanged.
- Mapping (Inventory → Trading): category → `PrimaryCategory`; condition enum → `ConditionID` (e.g. pre-owned excellent 2990, good 3000, fair 3010; the category's own allowed values first) + `ConditionDescription` for used items; aspects → `ItemSpecifics/NameValueList` (multi-value aspects keep all values); title (80 chars); description HTML (CDATA) incl. the store footer; photos → `PictureDetails/PictureURL` (https only; eBay copies them to its picture service; private draft photos are signed first); price → `StartPrice`; quantity 1; SKU; business policies → `SellerProfiles` (the calculated shipping policy picked as before, return policy from Settings or eBay's default, payment policy = eBay's default); package → `ShippingPackageDetails` (weight lb/oz, inches, package code); store category → `Storefront.StoreCategoryID` (now in the same call, no separate step); location → `PostalCode` (same default 10001 as before unless `EBAY_ITEM_POSTAL_CODE` / `EBAY_ITEM_LOCATION` holds a ZIP); GTC, fixed price, USD, US. Handling time comes from the shipping policy. Best Offer: not sent (the Inventory path didn't either).
- Same automatic fixes as before, at verify time: drop the package type if eBay rejects it, try the other spelling of the SAME condition tier, then the garment-safe fallback category. Nothing is listed until verify passes.
- **Never twice:** each listing carries a `UUID` derived from the draft (and the previous listing, for a later relist). If a response is lost and the call is retried, eBay answers "Duplicate UUID used" (error 488) with the existing item number, which is saved instead of listing again. The existing "already listed" guard still runs first.
- **Updating a listed draft** ("Update on eBay", was "Relist on eBay") now revises the live listing in place with ReviseFixedPriceItem: same item number, watchers kept. If eBay says the listing was made with the Inventory API, it falls back to the old end-and-recreate path for that one listing.
- **Check with eBay (doesn't list):** new button in the draft editor; runs only the verify step and shows eBay's answer and fee estimate.

## Step 2: edit live listings in place

- "Update on eBay" in the draft editor revises the live listing with **ReviseFixedPriceItem**: title, item specifics, photos, price, quantity, description, condition and condition note, package, store category. Same item number, watchers and history kept.
- Before revising, Listflow reads the live listing (**GetItem**). If it has ended, you're told to relist instead. Custom item specifics that exist on the listing (common on eBay-made listings) are kept as long as they're still in the draft. A listing made in the eBay app keeps its own category unless you picked one, and its own description HTML is sent back as-is.
- If eBay refuses a category/condition change (e.g. the listing already has a sale), the revise is retried without them. If the listing turns out to be an Inventory-API listing, the old end-and-recreate path is used for that one listing.

## Step 3: open any eBay listing in Listflow

- Listings → **Edit in Listflow** now works for every active listing, including ones made in the eBay app. It reads the listing from eBay (GetItem) and opens the linked Listflow draft, creating it the first time: title, price, condition, condition note, photos (eBay's own picture links), item specifics with the listing's category, store category, SKU (if it isn't already used by another draft) and eBay's description HTML. Then "Update on eBay" revises it in place.
- Nothing on eBay changes until you tap Update. Descriptions up to eBay's 500,000-character limit are accepted.

## Step 4: two-way sync

- **Opening a listed draft** re-reads the listing from eBay in the background. If only eBay changed since the last sync (e.g. you edited it in the eBay app), the draft takes eBay's version and reloads. If both changed, a banner asks: *Use eBay's version* or *Keep mine*.
- **Update on eBay** sends the fingerprint taken when the editor opened. If the listing changed on eBay in the meantime, you're asked before eBay's version is replaced; nothing is overwritten silently.
- **Background:** on app open (at most every 10 minutes) and in the daily job, `GetSellerEvents` lists what changed on eBay (last 48 h max), and linked drafts without local changes are refreshed (up to 15 per app open, 25 per day).
- Only eBay-owned fields are copied from eBay (title, price, condition, note, photos, description, specifics, store category, brand/size/colour); SKU, cost and Listflow notes are never touched.
- **Needs migration 034** for the saved fingerprints and the background sweep. Without it, the conflict check still works within an editing session, and nothing else changes.
