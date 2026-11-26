# Listflow — change notes

## Nov 25, 2026 — `feat/upgrade-v2b` (upgrade v2, rebuilt on today's fixes)

Base: `fix/settings-intro-layout` (46093a9 — newest; contains origin/main 8fb4acd, which GitHub confirmed is main's tip). The 5 commits from `feat/upgrade-v2` cherry-picked with **no conflicts**; today's price/floor fields, size mapping, store-category reset, unlock-after-error, store intro and Drafts integrity are untouched (their tests all pass). Built in a sandbox clone and fetched back (the mounted .git can't delete lock files; stale locks were moved to `.git/junk-to-delete/` — safe to `rm -rf`).

Status: all done. 913 tests green, `tsc` clean, `eslint` 0 errors, `next build` clean (sandbox build used a temporary system-font stub for layout.tsx because Google Fonts is unreachable here; not committed).

### What's in it
1. **Inventory** — one screen, Draft / Scheduled / Live / Sold / Ended filters; `/drafts`, `/store`, `/store/scheduled` redirect with filters kept.
2. **Background eBay sync** — app-wide agent every 5 min while open (read-only GetSellerEvents/GetItem); `/api/cron/ebay-sync` for every seller (CRON_SECRET), run by `.github/workflows/ebay-sync.yml` every 10 min — OFF until repo variable `EBAY_SYNC_ENABLED=true` + secret `CRON_SECRET` are set (Vercel Hobby crons are daily only; the daily `snapshot-listings` cron also runs a sync pass). eBay push notifications were not added (would need SetNotificationPreferences, a write to the eBay account).
3. **Finish on eBay** — main button for unpublished drafts; first use opens the explainer (scheduled listing → eBay app Selling → Scheduled; the eBay Drafts tab can't be filled by outside apps).
4. **Recycle bin** — delete = 7 days in `draft_trash` with Undo / Restore; daily cron purges row + photos; falls back to permanent delete until migration 037 is applied.
5. **"Synced with eBay X min ago"** + "live on eBay but not in Listflow" alert (Inventory + Home).
6. **eBay deprecations** — checked eBay's deprecation page 2026-11-25: **GetMyeBaySelling is NOT deprecated and has no date.** Deprecated Trading calls (GetOrders, CompleteSale, GeteBayDetails → 2027-06-30; discount profiles → 2027-01-30) are not used by Listflow. `src/lib/ebay-api-inventory.ts` + its test fail the build if code ever uses a deprecated call or a used call gets within 6 months of shutdown. Eventual replacement for GetMyeBaySelling/GetSellerEvents is the GraphQL Listing API `sellerListingSearch`; not switched now (not required, can't be verified without live eBay calls).
7. **Plans + Stripe (TEST MODE), OFF by default** — `src/lib/billing/*`, `/api/billing/{status,checkout,portal,webhook}`, `/membership`. Free (manual listing) / Pro $29 / Power Seller $59 / helper seats $10 each (proposal). Gated when on: AI (analyze, group photos, specifics, pricing, dividers), bulk (analyze-batch, batch-jobs, jobs/enqueue), auto-sync. Off = no DB read, nothing changes. Owner exempt via `BILLING_EXEMPT_USER_IDS`. Live keys refused (`sk_live_` → error), live-mode webhook events ignored. Helper seats are billed/recorded only — helper logins don't exist yet.
- **Rate limiting** — `src/lib/rate-limit-policy.ts`: needs `RATE_LIMIT_ENABLED=1` AND Upstash vars; per-IP per-min auth 30 / AI 120 / bulk 300 / general 600; cron, worker, webhooks, photo proxy never limited; fails open.

### Migrations (NOT applied)
- `037_draft_recycle_bin.sql` (was 035 on feat/upgrade-v2), `038_ebay_sync_state.sql` (was 036), `039_billing_subscriptions.sql`.

### Env vars the code no longer reads (grep 2026-11-25; listed for removal after approval, NOT deleted)
EBAY_RETURN_POLICY_ID, EBAY_SHIPPING_CALCULATED_ID, EBAY_SHIPPING_FREE_ID, EBAY_SHIPPING_HEAVY_ID, EBAY_OAUTH_REFRESH_TOKEN, EBAY_USER_TOKEN, EBAY_DEV_ID.

## Nov 25, 2026 — `fix/settings-intro-layout` (cleaner Store intro card)

Sel: the Store intro card was wordy and repeated the text. UI only, no data/API changes.
- Store intro: title + On/Off switch on one row, one-line subtitle "Shown at the top of every eBay description." Auto-growing textarea (whole text visible, no inner scroll). Character count only near the 2000 limit. Save is disabled until something changes, then turns into "Saved ✓"; flipping the switch also saves unsaved text. Off dims the editor and mock.
- The duplicated preview is replaced by a compact mock of eBay's Description: "eBay · Description" → highlighted "Your store intro" (skeleton lines) → "Item details & measurements" → "Shipping & returns". "Preview full description" opens a sheet with the real rendered intro (same escaped markup eBay gets) and the shipping notes.
- Same pattern on "Measurements: see photos" (switch in the title row, one-line subtitle) and "Shipping & returns notes" ("Shown at the bottom of every eBay description.", auto-grow, same Save row).
- New `src/components/SettingsTextCard.tsx` (AutoGrowTextarea, SaveRow, EbayDescriptionMock); `SettingsSection` takes an optional `action` for the title row. Render test `settings-text-card.render.test.ts`. 856 tests green, `tsc` + `next build` clean.

## Nov 25, 2026 — `feat/store-intro` (Store intro on every listing + "Measurements: see photos")

Asked by Sel: stop pasting the same welcome paragraph into every eBay listing. Write it once in Settings; it goes at the very top of eBay's item Description (where he was pasting it), exactly as typed.

### What changed
- **Settings → "Store intro (added to every listing)"** (new card, styled like Shipping & returns notes): On/Off switch, textarea (prefilled with a default only when nothing is saved), Save, character count, and a small "Where it lands on eBay" preview (intro → item details → Shipping & returns). Turning it On also saves the text on screen.
- **Settings → "Measurements: see photos"** (switch, default Off). The AI *does* add a measurement list to the description ("Measurements (taken flat)" from the tape-measure photos, built in `buildDescriptionHtml`). On = that list is replaced by "See photos for measurements." Item specifics (Chest Size etc.) are unchanged.
- `src/lib/store-intro.ts` (new, pure): `finalizeListingDescription` runs last on every description sent to eBay — Trading Verify + Add (`buildItemForDraft` → `publishDraftTrading`/`verifyWithFixes`), "Update on eBay" (`reviseDraftListing`), and the Inventory fallback (`upsertInventoryItem`). Intro is the first thing in the Description, above the title; Shipping & returns stays at the bottom.
  - Text kept line for line: each newline → `<br>` (blank lines stay blank), HTML-escaped, never reworded, never truncated (length is checked on save: max 2000; the API rejects longer rather than cutting). Sent in CDATA as before; plain `<p>`/`<br>` with inline styles, so it reads as normal text in the eBay app.
  - Idempotent: wrapped in `<!--lf-store-intro--><div class="lf-store-intro" data-lf="store-intro">…</div><!--/lf-store-intro-->`; any existing block is removed before inserting (so re-publish/revise never doubles it, and editing the intro replaces the old one). If the text is already present unmarked (hand-pasted, or eBay stripped markers) nothing is added; a hand-pasted copy in a plain draft description is removed from the summary so it isn't shown twice. eBay-made descriptions get the block first too.
  - Never saved into `drafts.description`.
- Review cards (Batch Upload, New listing, Draft editor, swipe Review) show only a subtle "+ Store intro will be added when listed" line (tap to preview) — `src/components/StoreIntroHint.tsx`, one shared `/api/settings` fetch per page.
- `GET/PATCH /api/settings`: `storeIntroEnabled`, `storeIntroText`, `measurementsSeePhotos`, read/written separately from the other settings so a database without migration 036 still loads/saves everything else (saving the intro then says "database update pending"). Publishing reads them separately too (missing columns = no intro, publishes normally).
- Tests: `store-intro.test.ts` (Sel's exact text: Description starts with it, every line + blank line + ":)" kept, no cutoff, idempotent, markers stripped by eBay, hand-pasted copy, see-photos swap), `trading-publish.test.ts` (Verify/Add/Revise send it at the top once), `store-intro-hint.render.test.ts`. 850+ tests green, `tsc` + `next build` clean.

### Migration (not applied)
- `supabase-migrations/036_store_intro.sql` — three additive columns on `app_settings` (`store_intro_enabled` bool default false, `store_intro_text` text, `measurements_see_photos` bool default false). Same per-user row/RLS as `store_description_footer`.

## Nov 25, 2026 — `fix/size-category-validation` (Lacoste polo: Size "9", frozen card, wrong shelf)

Reported: a Lacoste polo tagged "9" failed to list with `"9" is not a valid value for Size … (code 21920468)`, the batch card then couldn't be edited, and the item had been put on the "Outerwear & Coats" store shelf.

### Root causes (checked against the live draft row `5b77e243…` and the cached eBay metadata)
1. **Invalid Size.** eBay's Taxonomy metadata for Men's Polos (185101), T-Shirts (15687) and Coats (57988) marks `Size` as **FREE_TEXT** (84 listed values), so Listflow kept the AI's raw tag value. eBay's listing API actually enforces the list. Nothing translated brand sizing (Lacoste 9 = 4XL).
2. **Frozen card.** Every field on a Batch Upload card was `disabled={saveStatus === "saved"}`. "List on eBay" saves the draft first (→ "saved"), so when eBay rejected the listing the card stayed locked with no way to fix and retry.
3. **Wrong shelf.** The eBay category was right (Shirts > Polos); the *store* category was wrong. Store-category choices are kept per item **position** and were never cleared between batches (discarding a recovered batch kept them; the recovery snapshot re-saved them), so item #1 of the new batch inherited an earlier item #1's "Outerwear & Coats". The free keyword matcher also couldn't put a polo anywhere (it needs every word of "Tops, Tees & Sweaters" in the title), so nothing replaced the stale pick, and nothing checked the shelf against the item.

### What changed
- `src/lib/size-mapping.ts` (new): `strictDefs`/`effectiveMode` treat eBay's clothing **Size** list as selection-only; `mapTagSize` maps Lacoste 1–10 (2XS…5XL), XXL-style letters, "Large", "SMALL 36-38", "L/G", "IT/EU 50", collar sizes. Unmappable sizes are left blank → "Needed to publish", never sent raw.
- `mergeAspects` (all analyze/review/publish paths) applies the above using the item's Brand; `fetchAspectDefs` returns strict defs; `SpecificsEditor`/`AspectPicker` apply them to older saved analyses too.
- Publish: `buildPublishAspects` reports `rejected` values; `verifyWithFixes` refuses before calling eBay with `"9" is not a valid value for Size. Pick one of eBay's values (e.g. …)`. Mapped brand sizes keep the tag size: title `Size 9 (4XL)` (if ≤ 80 chars) and description `Size: 4XL (tag: Lacoste size 9 = 4XL)`.
- `src/lib/listing-problems.ts` (new): `aspectProblems` (pre-post check against the category's metadata) and `parseEbayFieldErrors` (eBay error text → field). Readiness gets `invalidSpecifics` and `storeCategoryIssue` blockers.
- Batch card: locked only while saving/listing or once listed (`src/lib/batch-card-state.ts`); a failed List drops "Saved" back to "Backed up"; edits re-enable Save; the field eBay named is outlined red, scrolled to and offered one-tap valid values. New **Check with eBay** button (VerifyAddFixedPriceItem — nothing listed). Per-item state is reset on a new batch / discard.
- Categories: `categoryFits` now rejects a top in Coats/Jackets/Vests and outerwear in Polos/T-Shirts/Dress Shirts; `consistencyIssues` flags Type vs category (Type "Polo" in Coats). Store shelf: kind-based fallback (polo → "Tops, Tees & Sweaters", jacket → "Outerwear & Coats"), `storeCategoryConflict` flags/blocks a polo on an outerwear shelf, and conflicting stale picks are replaced automatically.
- Tests: `size-mapping`, `listing-problems`, `batch-card-state`, `polo-category`, extra `trading-publish` cases (pre-flight never calls eBay; Lacoste sent as 4XL). 830+ tests green, `tsc` + `next build` clean.

### Notes / limits
- Only brand charts we're sure of are mapped (Lacoste). Other bare numbers are left for the seller.
- Changing the eBay category already reloads that category's aspects via `/api/ebay/specifics-refill`; values are re-validated against the new list (strict Size included).
- No migration. No data was changed.
