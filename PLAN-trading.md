# Trading API publishing (branch `feat/trading-publish`, Nov 24, 2026)

Why: listings made with eBay's Inventory API "cannot be edited through Seller Hub or any other listing platform" (eBay's Inventory API overview), so they could never be edited in the eBay app. Trading API listings are ordinary eBay listings: editable in the eBay app and revisable from Listflow.

## Step 1: publish with the Trading API

- `PUBLISH_API=trading` (default) or `inventory` (old path, for rollback; Vercel env var, then redeploy).
- Every publish is checked with **VerifyAddFixedPriceItem** first (validates without listing), then listed with **AddFixedPriceItem** using exactly the same item. Single listing, Analyze & list, Batch, Drafts "List", "List all Ready" and the server queue all go through the same `publishDraft()`, so all switch together. Readiness checks, SKU assignment, category choice, item specifics and description are unchanged.
- Mapping (Inventory → Trading): category → `PrimaryCategory`; condition enum → `ConditionID` (e.g. pre-owned excellent 2990, good 3000, fair 3010; the category's own allowed values first) + `ConditionDescription` for used items; aspects → `ItemSpecifics/NameValueList` (multi-value aspects keep all values); title (80 chars); description HTML (CDATA) incl. the store footer; photos → `PictureDetails/PictureURL` (https only; eBay copies them to its picture service; private draft photos are signed first); price → `StartPrice`; quantity 1; SKU; business policies → `SellerProfiles` (the calculated shipping policy picked as before, return policy from Settings or eBay's default, payment policy = eBay's default); package → `ShippingPackageDetails` (weight lb/oz, inches, package code); store category → `Storefront.StoreCategoryID` (now in the same call, no separate step); location → `PostalCode` (default 33125 unless `EBAY_ITEM_POSTAL_CODE` / `EBAY_ITEM_LOCATION` holds a ZIP); GTC, fixed price, USD, US. Handling time comes from the shipping policy. Best Offer: not sent (the Inventory path didn't either).
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

## Step 5: Finish on eBay (scheduled listings)

- Draft editor → **Finish on eBay (scheduled, 3 weeks out)**: lists the draft through the same verify + add path with `ScheduleTime` 21 days ahead. It's a real eBay listing that shows in the eBay app under **Selling → Scheduled**, where it can be edited and started with "List it now". Listflow keeps the item number, so it can also be finished here ("Update on eBay" revises it).
- **Fee (checked Nov 24, 2026):** eBay's US "Selling fees" help page lists *Scheduled Listing* as free (eBay.ca and eBay.co.uk say the same). The usual insertion-fee rules apply as for any listing (free within the monthly free-listing allowance). The confirm dialog says this before anything is sent.
- **Listings → Scheduled** (`/store/scheduled`): every scheduled listing on eBay (`GetMyeBaySelling` ScheduledList), including ones scheduled in the eBay app, with **Finish** (opens it in Listflow's editor) and View on eBay.
- The schedule date is saved on the draft with migration 034 (`ebay_scheduled_for`); not needed for any of this to work.

## Step 6: price drops, bulk price, relist, store category

- **Price drop / bulk price cuts** (Listings, background tray): `ReviseFixedPriceItem` with the new price. This works on Trading listings (everything Listflow lists from now on, and everything made on eBay.com). For a legacy Inventory-API listing (eBay error 21919474) it now changes the price through the listing's Inventory offer instead (found by SKU), so it works for both.
- **Relist** (Listings → Ended): `RelistFixedPriceItem` works for Trading listings. The linked Listflow draft now follows the new item number eBay gives a relisted listing (it used to keep pointing at the ended one). A legacy Inventory-API listing gets a clear message (list it again from its draft, or relist in the eBay app).
- **Store category**: sent inside AddFixedPriceItem / ReviseFixedPriceItem (`Storefront.StoreCategoryID`), so there's no separate call that can fail after listing. The old separate call is only used by the Inventory path.
- **End listing** already uses Trading `EndItem`, which works for both kinds.

**Legacy listings found:** 4 drafts already have eBay item numbers (created Jun 20 – Sep 11, 2026, no publish date recorded): items 168476823728, 168477212439, 168526572701, 168679902532. If they were listed through Listflow back then, they're Inventory-API listings. Everything above falls back correctly for them.

## Step 7: tests

Mocked Trading responses cover: VerifyAdd success / failure (nothing listed), verify-only (no Add), Add success, warnings, lost-response retry and duplicate UUID (error 488 → existing item number saved, never listed twice), the package / condition / category retries, Revise in place, the Inventory-API refusal (21919474) and its price fallback, GetItem parsing + fingerprint, import into a linked draft, GetSellerEvents parsing, sync decisions (in sync / eBay-only change / conflict / first sync / before migration 034), scheduled listings, and the `/api/ebay/list` route (Trading dispatch, rollback flag, update in place, conflict refusal and forced overwrite). The existing route, regression and queue end-to-end tests run unchanged (the queue still calls the same `publishDraft()`).

## Not verified live

No real eBay call was made from this session (Sel's eBay token can only be decrypted on Vercel). First real check: the **Check with eBay (doesn't list)** button runs VerifyAddFixedPriceItem on a real draft without listing it.
