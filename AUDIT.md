# Listflow — code-side audit (Nov 18, 2026, prod `6fb6257`)

**Scope:** every page, API route, background job and shared library, read from the code. Hands-on clicking through the live app is being done separately.

**Not run:** live eBay calls. This session can't use Sel's eBay token, so anything that depends on an eBay response is marked **(unverified live)**.

**Ratings:**
- **Solid:** wired end to end, handles errors, tested where it matters.
- **Needs work:** works, but has a real gap: missing data, scale limits, untested risky logic or confusing behaviour.
- **Broken:** gives wrong results or can't do its job as built.

---

## 1. Summary

| Area | Rating | One-line verdict |
|---|---|---|
| Listing (New Listing, Analyze & list, publish) | Solid | Core flow is end-to-end, idempotent, with background publishing. |
| Batch Upload → List all | Needs work | Works, but publishing only continues while the app is open; 3,000-line page. |
| Drafts (list, filters, bulk edit, swipe) | Solid | Good; bulk edit is server-validated and tested. |
| Draft editor + relist | Solid | Untested but stable; relist path has careful rollback. |
| Listings / Store (search, stale, price sheet, end/relist) | Needs work | Price sheet is good. The "Pending offers" link covers only 60 listings (see Offers). |
| **Offers** | **Broken (at Sel's scale)** | Checks only the **first 60 of ~1,172** active listings for offers; the rest are never seen. |
| Messages (buyer questions) | Needs work | Item fix is in, but only the **first page** of eBay messages is read; no pagination. |
| Ship (to ship) | Needs work | Shipped detection is now multi-signal. **(unverified live)**: the root-cause fix hasn't been confirmed on Sel's orders yet. |
| Sales analytics + ledger | Solid | Integer cents, exact tie-outs, many tests. The "Matches eBay" status-filter fix is **(unverified live)**. |
| Dashboard + Needs attention | Needs work | Correct, but **5 eBay-backed requests on every visit**, incl. a full listings pull just to count stale items. |
| Watcher offers (Negotiation API) | Needs work | Built and tested offline; **(unverified live)** — needs eBay permission, untried on Sel's account. |
| Settings | Needs work | Works; one setting PATCH per toggle (fine). The "12 requests" earlier estimate was wrong: it's 1 GET + 2 policy calls on load. |
| Auth (login, lockout, reset, delete) | Needs work | Lockout and soft-delete are good. **Password reset link doesn't work** (Supabase redirect URL not set). |
| Background jobs (crons) | Needs work | Purge + snapshot scheduled. **Daily digest email is never triggered** (no hourly scheduler). |
| Billing / Membership | Broken (not built) | UI only; no Stripe. Expected (deferred), listed for completeness. |
| Security (auth, RLS, secrets) | Solid, with gaps | Every API route checks the user; RLS on all tables. Gaps: **rate limiting is off** (Upstash not configured), a public test route, defense-in-depth on one update. |

---

## 2. Feature by feature

### Listing — New Listing / Analyze & list / publish
- **Purpose:** photos → AI title/price → live eBay listing in as few taps as possible.
- **Wired:** UI → `/api/analyze-item` (OpenAI) + `/api/pricing/suggest` → save draft (`/api/drafts`) → `/api/ebay/list` (Inventory API: item, offer, publish) → draft gets `ebay_listing_id`. Yes, end to end.
- **Errors:**
  - eBay errors come back with eBay's own message and error id.
  - Expired token returns `reconnect: true` (shows "Reconnect eBay", not a forced logout).
  - The duplicate-publish guard makes retries safe.
  - Package-type errors retry once without the package type.
  - Network failure shows an error and the draft is kept.
- **Edge cases:**
  - Photos 1–24 enforced; title ≤ 80; price > 0; condition required.
  - Calculated-only shipping with automatic policy pick; clear error if there's no calculated policy.
  - SKU collisions retried (8 attempts).
- **Gaps:**
  - The `/api/ebay/list` route (≈500 lines) has **no route-level tests**. Its pure helpers are tested: package, SKU, policy.
  - Photos pre-uploaded and then removed before saving stay in storage (orphans).
- **Rating:** Solid.

### Background publish/price queue + tray
- **Purpose:** keep listing / price changes going while Sel moves around the app.
- **Wired:** client-side queue → `/api/ebay/list` or `/api/ebay/update-price`. Yes.
- **Errors:** per-item eBay message, retry button, reconnect prompt.
- **Edge cases:**
  - **Runs only while Listflow is open in that tab**; closing the app pauses it.
  - Drafts are saved first, so nothing is lost, but unpublished items wait in Drafts with no "resume" prompt.
  - Price changes not yet sent are simply dropped.
  - Failures are lost on reload. The "Needs attention → failed listings" count resets too.
- **Gaps:** move to a server-side queue (the `batch_jobs` table already exists).
- **Rating:** Needs work.

### Batch Upload
- **Purpose:** many photos → AI groups them into items → analyze → list all.
- **Wired:** `/api/group-photos`, `/api/detect-item-dividers`, `/api/analyze-batch`, `/api/pricing/suggest`, `/api/drafts`, then the publish queue. Yes.
- **Errors:**
  - Per-item analysis/price errors are shown, with retry.
  - Crash recovery via IndexedDB.
  - AI usage cap is enforced server-side.
- **Edge cases:**
  - Partial failures are listed per row.
  - Large batches are bounded by photo/AI limits.
- **Dead/duplicate code:**
  - `batch_jobs` / `batch_job_items` are **written but never read** by any screen. `/api/batch-jobs/*` is tracking-only.
  - The "List all" path no longer uses them; only "retry failed" still writes them.
  - Legacy heavy / flat-rate shipping state still lives in this page (`heavyItems`, `shippingCosts`, `buyer_pays`) even though shipping is calculated-only.
- **Gaps:**
  - The 3,031-line component is hard to change safely.
  - No tests for grouping/analysis orchestration.
- **Rating:** Needs work.

### Drafts list, filters, bulk edit, swipe
- **Purpose:** find, fix and list saved drafts quickly.
- **Wired:** `/api/drafts` (server paging, search, filters), `/api/drafts/bulk`, `/api/drafts/[id]/duplicate`, delete. Yes.
- **Errors:** inline errors; bulk returns updated / failed / skipped-live counts.
- **Edge cases:**
  - Paging; deep links `?filter=needs-price|needs-photo`.
  - Bulk is capped at 200 ids. Drafts already on eBay are skipped.
  - Titles over 80 characters are never saved.
- **Tests:** bulk-edit maths, swipe gestures, readiness.
- **Rating:** Solid.

### Draft editor (+ relist)
- **Purpose:** edit every field and photo, then publish or relist.
- **Wired:** `/api/drafts/[id]` GET/PATCH/DELETE, store-category AI, `/api/ebay/list` with `allowRelist`.
- **Errors:**
  - A stale-write guard (409 "changed in another tab") via `updated_at`.
  - Failed relists clear the dead listing id and say so.
- **Gaps:**
  - No tests.
  - Leftover drag-and-drop handlers (`onPhotoDrag*`) are defined but never used (lint warnings).
- **Rating:** Solid (with cleanup).

### Listings / Store
- **Purpose:** see every active/ended listing, find stale ones, change prices, end/relist.
- **Wired:**
  - `/api/ebay/store` (GetMyeBaySelling, all pages, ≤ 10,000; joined to drafts for id / cost / watch count).
  - `/api/ebay/update-price` (ReviseFixedPriceItem), `/api/ebay/delist`, `/api/ebay/relist`, `/api/ebay/inventory`.
- **Errors:**
  - Price changes run in the tray with eBay's message and retry.
  - End/relist ask for confirmation first.
- **Edge cases:**
  - Stale filter and "Lower prices on all N stale" (floor and item cost respected, never raises a price).
  - 1,000+ rows render as one long list. It works, but there's **no list virtualization**.
- **Security:** `update-price` updates `drafts.suggested_price` by `id` with RLS only. Add `.eq("user_id")` for defense in depth.
- **Rating:** Needs work (scale + offers link).

### Offers (Best Offers)
- **Purpose:** see and answer buyers' Best Offers (accept / counter / decline).
- **Wired:** `/api/ebay/offers` → `fetchPendingOffers()` → **GetBestOffers once per listing, capped at the first 60 active listings** (`OFFERS_LOOKUP_MAX = 60`), then `/api/ebay/offers/respond`.
- **Bug:**
  - With ~1,172 active listings, ~95% of listings are **never checked**. Offers on them don't appear here or in Needs attention.
  - The page shows a small "truncated" note, but the count looks authoritative.
- **Fix:** call GetBestOffers **without an ItemID**, which eBay documents as returning offers across all of the seller's listings — verify live. Otherwise check the listings with watchers or Best Offer enabled first, and paginate.
- **Rating:** **Broken at Sel's scale.** Counter presets are fine and tested.

### Messages (buyer questions)
- **Purpose:** answer unanswered buyer questions.
- **Wired:** `/api/ebay/messages` (GetMemberMessages, AskSellerQuestion, Unanswered, last 30 days) and `/api/ebay/messages/respond` (AddMemberMessageRTQ).
- **Edge cases:**
  - **No pagination**: eBay returns the first page only (25 by default). Older unanswered questions beyond page 1 are invisible.
  - Questions older than 30 days are never shown.
  - General messages (not tied to a listing) work, using the buyer's open order or "General message".
- **Tests:** parsing tested; enrichment via GetItem tested.
- **Rating:** Needs work.

### Ship (to ship)
- **Purpose:** list paid orders still to be shipped.
- **Wired:** `/api/ebay/ship` → GetSellerTransactions (all pages, last 30 days) + Finances labels → multi-signal `shipState`. The same function feeds the Needs attention count and the daily digest.
- **Edge cases:**
  - Orders paid more than 30 days ago and not modified since drop off the list even if unshipped. Rare, but possible.
  - **(unverified live)**: confirm the Tool hat and Levi's orders are gone.
- **Better source later:** the eBay Fulfillment API, which needs a new permission and a reconnect.
- **Rating:** Needs work until confirmed on live data.

### Sales analytics, ledger, costs
- **Purpose:** exact profit and where the money goes, from eBay Finances.
- **Wired:**
  - `/api/ebay/sales/analytics`: one ~90-day feed, cached 3 minutes.
  - `/api/ebay/finances/summary`: per-status cross-check.
  - `/api/ebay/sales/thumbnails` and `/api/sales/costs`.
- **Errors:**
  - Finances unavailable → labelled estimates.
  - Truncation warnings.
  - A reconnect prompt for an expired token.
- **Edge cases:** eBay's 90-day limit is handled (90d shows no prior-period comparison); refunds, disputes and pass-through tax are handled.
- **Tests:** strongest in the app (ledger, tie-outs, periods in 5 time zones, render).
- **Gaps:**
  - **(unverified live)** "✓ Matches eBay" after the status-filter fix.
  - The old `/api/ebay/sales` route (341 lines) still exists only for the Dashboard sparkline. That's a duplicate data path.
- **Rating:** Solid.

### Dashboard + Needs attention
- **Purpose:** one screen: what needs doing today plus headline numbers.
- **Wired:** 8 requests in parallel on every visit.
  - **5 of them hit eBay:** `/ebay/ship` (+ a Finances call), `/ebay/offers` (up to 60 GetBestOffers), `/ebay/messages`, `/ebay/store` (**full GetMyeBaySelling pull of all ~1,325 listings just to count stale ones**), and `/ebay/sales?days=28`.
  - Plus 3 Supabase calls.
- **Edge cases:** cached counts show instantly; failures keep the last value.
- **Performance:** the heaviest screen for eBay call volume. Recommended:
  - one `/api/dashboard/summary` endpoint with server caching (5–10 minutes);
  - the stale count from the existing snapshot or store cache;
  - the sparkline from the analytics feed.
- **Rating:** Needs work.

### Watcher offers (Negotiation API)
- **Purpose:** send a 10/15/20% offer to interested buyers instead of a public price cut.
- **Wired:** `/api/ebay/offers/watchers` GET (eligible items) and POST (send). Validated input; a reconnect message on 401/403.
- **Gaps:** **(unverified live)**: eBay permission isn't confirmed for Sel's token, and bulk "offer to all stale with watchers" isn't built.
- **Rating:** Needs work.

### Settings
- **Purpose:** eBay connection and policies, fee %, store footer, theme/accent, notifications, photo layout, account deletion.
- **Wired:** `/api/settings` GET once + one PATCH per change; `/api/ebay/policies` GET/PATCH; `/api/account/delete`.
- **Dead/duplicate:**
  - `app_settings.default_shipping_mode` is still read and written, but every value is forced to "calculated".
  - The Free/Heavy policy columns (`shipping_free_policy_id`, `shipping_heavy_policy_id`) and the deprecated Vercel env vars are unused.
  - The notification email toggle saves, but **nothing sends** (no hourly trigger).
- **Rating:** Needs work (misleading email toggle).

### Auth and account
- **Purpose:** login, lockout, forgot/reset password, pending deletion and reactivation.
- **Wired:** Supabase auth plus `/api/auth/lockout` (public by design, service-role RPC), `/api/account/*`, and the purge cron.
- **Gaps:**
  - **Reset link fails** (Supabase redirect URL not allow-listed).
  - Leaked-password protection is off (needs Supabase Pro).
- **Rating:** Needs work.

---

## 3. Cross-cutting checks

### Error handling
- eBay errors are surfaced with eBay's own message on list, price, offers, sales and ship. Token expiry consistently maps to a "Reconnect eBay" prompt (200 + `reconnect: true`, so the app doesn't log you out).
- **Rate limits:** there's no explicit handling of eBay 429 / "call limit exceeded" anywhere. Those show as generic errors.
  - Only the price queue paces itself (350 ms between calls).
  - The Dashboard and Offers fan out up to 60 parallel-ish calls (5 at a time).
- **Network failure:** client pages show a toast and keep cached data. Publish/price tasks fail with retry.

### Security
| Check | Result |
|---|---|
| Every `/api/*` route requires a signed-in user | ✅ The proxy gate plus `requireUser()` in each route. Exceptions by design: `/api/auth/lockout` (pre-login), `/api/ebay/callback` (OAuth, state-checked), `/api/cron/*` (`CRON_SECRET`). |
| `/api/sentry-test` | ⚠️ Leftover debug route that just throws. Signed-in only, but should be deleted. |
| RLS | ✅ All 7 live tables are owner-scoped (`login_attempts` service-role only). Migrations 025 (if applied) and 026 follow the same pattern. Storage: per-user folders, public bucket (needed for eBay images). |
| Secrets | ✅ The service role is only in server files, `.env*` is ignored, and eBay refresh tokens are AES-GCM encrypted at rest. Deprecated env vars should be removed. |
| Input validation | ✅ Item ids are regex-checked on the eBay-mutating routes, prices are numeric-checked, bulk edits are validated server-side, costs are bounded. ⚠️ `update-price` accepts any positive price (no $0.99 floor server-side) and updates the draft without a `user_id` filter (RLS still protects). |
| Rate limiting | ❌ **Disabled in production**: Upstash env vars aren't set, so the proxy's limiter silently no-ops (AI endpoints included). |
| Global SKU index | ⚠️ `drafts_custom_sku_unique` is unique across all users (multi-seller blocker; see LAUNCH-READINESS). |

### Performance hotspots
1. Dashboard: 5 eBay-backed calls per visit, including a full listings pull (above).
2. Offers: up to 60 GetBestOffers calls per load (and incomplete).
3. Store: renders every listing at once (~1,300 cards) with no virtualization; a heavy DOM on phones.
4. Sales analytics first load: ~3 transaction windows plus Finances paging (60-second function limit set). Fine for now.
5. The publish/price queue is client-side; long runs depend on the phone staying awake.
6. Shared bundle: Sentry + Supabase ≈ 66 KB gzipped on every page.

### Dead code, duplicates, leftovers
- **Old routes and tables:**
  - `/api/ebay/sales` (old route) duplicates the analytics feed; it's used only by the Dashboard sparkline.
  - `/api/batch-jobs/*` and its tables are written, never read.
- **Leftover heavy / flat-rate shipping code:**
  - 27 references in pages: `is_heavy`, `shipping_cost`, `buyer_pays`, `shippingCosts`;
  - `default_shipping_mode`;
  - the free/heavy policy columns.
- **Unused UI code:** unused drag-and-drop handlers and variables (most of the 28 lint warnings).
- **Debug route:** `/api/sentry-test`.
- **Dormant feature:** the daily-digest cron route with no scheduler, and a Settings toggle for it.
- **TODOs:** only one real TODO (login page, re-enabling self-serve signup copy).

### Test coverage
- **Well covered (333 tests):**
  - money and analytics: ledger, sales analytics, finance matching, price cuts, bulk edit, pricing, fees, profit, shipping/packages;
  - listing helpers: ship status, SKU assignment, publish queue;
  - UI behaviour: attention, swipe, z-layers, render tests for Sales, Sheet, Price/BulkEdit sheets and the nav.
- **No tests:**
  - **all 48 API route handlers**;
  - the eBay transport/parsers: `ebay-inventory`, `ebay-listings`, `ebay-offers`, `ebay-oauth`, `ebay-finances`, `ebay-ship-orders`, `ebay-store-categories`;
  - auth and account deletion: `auth`, `account-deletion`, `ebay-token-crypto`, `pwned-password`;
  - batch recovery, storage, email;
  - every page except Sales.
- **Highest-value gaps:**
  - `/api/ebay/list` orchestration with a mocked eBay;
  - offers fetching;
  - token crypto round-trip;
  - lockout;
  - drafts PATCH stale-write guard.

---

## 4. Prioritized fix list

### P1 — wrong results or blocked work (do next)
1. **Offers only checks 60 of ~1,172 listings.** Switch to a seller-wide GetBestOffers (no ItemID) or prioritise listings with watchers / Best Offer. Update Needs attention to match. *(S–M)*
2. **Verify the three live-only fixes on Sel's account,** with the separate browser test:
   - To ship drops shipped orders;
   - "✓ Matches eBay" appears;
   - watcher offers send.

   Fix whatever the live data shows. *(S)*
3. **Turn on rate limiting** (add Upstash keys in Vercel; the code is already there). *(S, config)*
4. **Password reset link**: add the production URL to Supabase Auth Redirect URLs. *(S, config)*

### P2 — scale, reliability, clarity
5. **Messages pagination:** read all pages of unanswered questions. *(S)*
6. **Dashboard:**
   - one cached summary endpoint;
   - stale count without pulling every listing;
   - sparkline from the analytics feed;
   - retire `/api/ebay/sales`.

   *(M)*
7. **Server-side background queue** for publishes and price changes (reuse `batch_jobs`), so work continues with the app closed and failures survive a reload. *(L)*
8. **Store list virtualization** for 1,000+ listings. *(M)*
9. **eBay rate-limit handling:** detect "call limit" errors, back off, and say so plainly. *(S–M)*
10. **Route tests** for `/api/ebay/list`, `/api/ebay/offers`, `/api/drafts/[id]` PATCH, and the lockout. *(M)*
11. **Hide or label the notification-email toggle** until a scheduler exists, or add the external hourly trigger. *(S)*

### P3 — cleanup and hardening
12. Delete `/api/sentry-test`. *(S)*
13. Remove the leftover heavy / flat-rate shipping code, the free/heavy policy columns from the UI, `default_shipping_mode`, and the deprecated Vercel env vars. *(M)*
14. Remove unused drag-and-drop handlers and variables (most of the 28 lint warnings). *(S)*
15. `update-price`: server-side $0.99 floor and `.eq("user_id")` on the draft update. *(S)*
16. Clean up orphaned pre-uploaded photos (periodic sweep). *(S)*
17. Split Batch Upload into steps (PLAN-ux 3.1). *(L)*
18. Per-seller SKU uniqueness (LAUNCH-READINESS P0 #2). *(S, migration)*

---

## Fix status (Nov 17, 2026 — branch `fix/audit-p1-p2`)

| Item | Status |
|---|---|
| P1 Offers coverage | ✅ Seller-wide `GetBestOffers` (no ItemID), 200/page, every page. Falls back to the old per-listing lookup (flagged "partial") only if eBay refuses. Known eBay caveat: offers already countered by the seller may not appear in the seller-wide call. |
| P2 Buyer questions | ✅ `GetMemberMessages` asks for 200/page and reads every page (cap 10 pages = 2,000 questions). |
| update-price floor | ✅ Server rejects < $0.99 and < the draft's cost; draft update scoped to `user_id`. |
| `/api/sentry-test` | ✅ Deleted. |
| Email digest toggle | ✅ Shown as "Email alerts (coming soon)"; flip `EMAIL_DIGEST_LIVE` in settings/page.tsx once a scheduler exists. |
| Unused drag-and-drop code | ✅ Removed (lint warnings 28 → 15). |
| Legacy heavy/flat-rate state in Batch Upload | ⏸ Left in place: it still feeds the price suggestion, the saved-session restore and two API payloads, so removing it isn't low-risk. Do it with the Batch Upload split (PLAN-ux 3.1). |
| P2 Dashboard | ✅ One `/api/dashboard/summary` request, cached per seller for 2 minutes (bypass with `?fresh=1`, cleared after answering an offer or question). Stale count uses an oldest-first sorted binary search (~7 tiny calls) instead of pulling every listing. `/api/dashboard/stats` is no longer used by the app. |
| Route tests | ✅ `/api/ebay/list` (auth, validation, user scoping, idempotent retry, never calls eBay on bad input), `/api/ebay/offers` (450 listings, offers past the old cap, fallback), `/api/ebay/update-price` (floors, scoping). |
| Rate limiting | Code ready; also accepts Vercel's `KV_REST_API_*` names. Needs Sel to create the Upstash database. |
| Password reset redirect | Needs Sel (Supabase dashboard; no connector tool for auth URL settings). |
