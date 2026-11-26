# Listflow — change notes

## Nov 26, 2026 — `feat/phase-1` (roadmap Phase 1 + competitor study)

Base: `docs/roadmap` (= main `07232dc` + ROADMAP). Built in a sandbox clone, fetched back. **Nothing was applied to the live database, nothing was sent to eBay** (all eBay calls in this branch that write — offers — are behind switches that are off).

### What's done
1. **Competitor gaps** section in ROADMAP.md (Vendoo, List Perfectly, Crosslist, PrimeLister, Flyp, Closo, eBay Magical Listing, eBay's own automated offers, 2026 entrants) + priority changes.
2. **Hauls + profit** (Business screen, new nav item): log a trip, add items (grouped by day), split cost evenly or by price (to the cent; keeps hand-typed costs unless "Replace all"), profit per haul/item, sell-through, return. `src/lib/hauls.ts`, `/api/hauls`, migration 041.
3. **Bins + pick list**: Bin/shelf field in the draft editor (saved separately via `/api/drafts/extras`), To-ship shows bin + SKU, "Pick list (by bin)" view with Print. `src/lib/bins.ts`, migration 041.
4. **Automatic offers to watchers** — OFF by default, three locks: env `AUTO_OFFERS_ENABLED=1`, Settings → Automation switch, item opt-in (or "all live items"). Never below floor, cost or $0.99 (smaller % or skip); items with no floor and no cost are skipped; min days listed + repeat window; 50/run; logged in `auto_offer_log`. Runs from the daily `snapshot-listings` cron. "Preview what would be sent" in Settings is read-only. Warns about eBay's own automated offers. `src/lib/auto-offers*.ts`, migration 042.
5. **AI**: reads up to 24 photos/item (was 16); batch upload waits longer instead of dropping still-uploading tag shots. **Learn my fixes** (OFF by default, migration 043): repeated corrections (2+) on brand/color/material/style/pattern/type/neckline/sleeve/fit are applied to new results (fields, specifics, brand in title); list/forget in Settings. **Hard-item escalation**: env `AI_ESCALATION_MODEL` (e.g. `gpt-4o`; unset = off) re-reads items whose brand/size weren't read from a tag or that look vintage.
6. **Photo storage**: diagnosed live — 470 files / 214 MB in the old shared `photos/public/` folder (Jun–Aug, before per-seller folders) that no sweep looked at; 180 unused files / 78 MB in the seller folder; 18 unused in `photos-private` (never swept). Fix: orphan sweep covers both buckets; old folder only when env `PHOTO_LEGACY_OWNER_ID` = Sel's user id, only unused by any seller and 30+ days old; Settings "Check storage" (preview) + "Clean up now"; every run logged. (Why the 180 weren't removed by the existing sweep couldn't be proven — Vercel Hobby keeps 1 h of logs; most likely the sweep hadn't run since "unused photos" was switched on. The new preview shows it.)
7. **Migration 025**: live check shows its index exists but `sale_costs` doesn't (half-ran; its `create policy` lines aren't re-runnable). **040** replaces it (idempotent).
8. **eBay permission upgrade**: refresh asks only for granted scopes (`granted_scopes`, migration 044; unknown = original 5) and falls back to the original 5 if refused. Settings shows "Reconnect eBay to unlock" (`/api/ebay/connect?scopes=extended`: + sell.marketing, sell.analytics.readonly, sell.fulfillment). Cancelling on eBay changes nothing.

### Migrations (NOT applied) — 040, 041, 042, 043, 044. All idempotent (verified by running each twice on PGlite), additive, rollback notes inside.

### Env vars (all optional; unset = feature off)
`AUTO_OFFERS_ENABLED=1` (real sends), `AI_ESCALATION_MODEL=gpt-4o`, `PHOTO_LEGACY_OWNER_ID=<Sel's user id>`.

### Self-review (Phase 1)
Re-read every diff against the rules: flags default OFF (offers: env + setting + opt-in; learn fixes; escalation; legacy sweep; extended scopes opt-in) ✓ · floor/cost enforced in the planner and re-checked by tests (floor, cost, 5% minimum, no-floor skip, rounding down) ✓ · no eBay writes during development; preview is read-only ✓ · migrations additive + idempotent ✓ · today's flows: draft save only gained a read-before-save for learnable fields and a post-response record (errors swallowed); new columns are saved through a separate endpoint so a missing migration can't break saving; ship route's bin lookup falls back without the column; callback falls back without `granted_scopes` ✓. Found + fixed during review: nav test expected the old link list; offer price now rounds DOWN for the floor check; haul split keeps hand-typed costs and splits only the remainder. Results: **974 tests green (was 913)**, `tsc` clean, `eslint` 0 errors (16 warnings, same as main), `next build` clean (sandbox build stubs Google Fonts in a throwaway copy, not committed).

### How to resume
Branch `feat/phase-2` starts from `feat/phase-1`. Work in a clone (`git clone ~/Downloads/listflow`), `npm ci`, run `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, build.

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
