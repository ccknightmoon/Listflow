# Listflow

AI-powered eBay listing assistant for resellers. Snap photos of items → AI identifies the item, suggests a title and pricing → review and post to eBay.

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 14.2.35 (App Router, TypeScript) |
| Styling | Tailwind CSS |
| Icons | Lucide React |
| AI | OpenAI GPT-4o-mini (vision) |
| Database | Supabase (PostgreSQL) |
| Deployment | Vercel |

Environment variables required:
- `OPENAI_API_KEY` — server-side only
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_OAUTH_REFRESH_TOKEN`, `EBAY_RUNAME`
- `EBAY_SHIPPING_FREE_ID`, `EBAY_SHIPPING_HEAVY_ID`, `EBAY_RETURN_POLICY_ID`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — optional. Powers rate limiting on the AI vision endpoints (see below). If unset, rate limiting is silently skipped rather than the app failing.
- `EBAY_SHIPPING_CALCULATED_ID` — optional. A "Calculated: cost varies by buyer location" shipping Business Policy ID, created in eBay Seller Hub (Account → Business Policies → Shipping → Create shipping policy → Calculated). Only required if "Calculated shipping" is ever selected (in `/settings` or per-item); listing with that mode fails with a clear error until this is set.

## What's Built

### Pages
- `/` — Landing/splash page
- `/login` — Supabase sign-in/sign-up
- `/dashboard` — Live stats (drafts, active listings, weekly revenue + sold count) + quick action cards. "To ship" card shows urgent badge when items are awaiting shipment.
- `/new-listing` — Single item flow: 3-photo slots (front, measurements, flaws) → AI analysis + live pricing in parallel → save draft / list on eBay
- `/batch-upload` — Multi-item workflow: upload → AI photo grouping → manual review → bulk analysis → results with bulk list/save actions
- `/drafts` — Unlisted drafts with thumbnails, pricing info, no-price warning, bulk delete, bulk list with price guard
- `/drafts/[id]` — Edit draft, AI suggest specifics, re-analyze with new photos, list / relist on eBay
- `/store` — Active + recently-ended eBay listings (Supabase + eBay merged), tabbed. Active tab: search, sort, inline price edit, bulk price update, delist. Ended tab: read-only, "Relist on eBay" link (eBay only retains a recent window of ended-unsold listings — there's no way to widen that from our side).
- `/sales` — Sales history with 7d/30d/90d/1y toggle, total revenue, per-item thumbnails
- `/ship` — Items paid but not yet shipped: buyer name/address, days-since-payment badge, Ship → link to eBay order
- `/membership` — Pricing plans UI only (Stripe deferred)
- `/privacy`, `/terms` — static Privacy Policy / Terms of Service pages, public (no login required)
- `/settings` — App-wide defaults, organized into labeled sections: **Default shipping** (Free / Calculated, every new listing starts on this), **Appearance** (Light / Dark / System — see Theming below), **Account** (sign out). Linked from a gear icon on `/dashboard`.

### API Routes
- `POST /api/analyze-item` — GPT-4o-mini vision, 1–3 photos; returns itemType, brand, color, size, condition, flaws, title, style, material, pattern, fit, vintage, theme, character, yearManufactured, season, description, and measurements (pitToPit, length, waist, inseam read from measuring tape in photo)
- `POST /api/analyze-batch` — Sequential batch analysis with rate limit handling and retry logic
- `POST /api/group-photos` — GPT-4o clusters mixed uploaded photos into per-item groups
- `GET|POST|DELETE /api/drafts` — Supabase CRUD for saved drafts
- `GET /api/drafts/[id]` / `PATCH /api/drafts/[id]` / `DELETE /api/drafts/[id]`
- `POST /api/ai/suggest-specifics` — fills eBay item specifics from existing draft fields
- `POST /api/pricing/suggest` — live pricing via eBay Browse API (image search → text fallback → condition-adjusted median)
- `GET /api/ebay/ship` — paid-but-unshipped orders from GetSellerTransactions
- `GET /api/ebay/sales?days=7|30|90|365` — sales history (multi-window, chunked into 30-day GetSellerTransactions calls and merged; capped at 365 days)
- `GET /api/ebay/store` — active + ended-unsold listings via GetMyeBaySelling (ActiveList + UnsoldList, each independently paginated)
- `GET /api/ebay/inventory` — Supabase-sourced listings (instant load for store page)
- `POST /api/ebay/list` — full listing flow: upsert inventory → create/update offer → publish
- `POST /api/ebay/delist` — end listing, clear from Supabase
- `POST /api/ebay/update-price` — ReviseFixedPriceItem + update Supabase
- `GET /api/ebay/connect` / `GET /api/ebay/callback` — OAuth flow
- `GET /api/dashboard/stats` — aggregated stats for dashboard
- `GET|PATCH /api/settings` — reads/writes the singleton `app_settings` row (currently just `default_shipping_mode`)
- `GET /api/ebay/store-categories` — fetches the seller's eBay Store custom categories (Trading API `GetStore`), flattened to leaf categories with a "Parent / Child" display path; returns `{categories: [], connect: true}` if eBay isn't connected

### Notable Implementation Details
- **node:https for all eBay + OpenAI calls** — Next.js 14 patches `globalThis.fetch` which breaks repeated outbound HTTPS. All external API calls use `node:https` directly. Every route using it must export `runtime = "nodejs"`.
- **eBay Trading API URL**: `https://api.ebay.com/ws/api.dll` (not `/ws/services`)
- Client-side image resizing before upload (max 1568px) to reduce API token cost
- Batch upload uses explicit step state machine: `upload → grouping → review → analyzing → results`
- Sequential (not parallel) batch processing to respect OpenAI rate limits; 3 retries with 15s delay on rate-limit errors
- AI measurements injected as first line of `description` field — not stored as separate DB columns
- GetSellerTransactions requires `<DetailLevel>ReturnAll</DetailLevel>`, but — despite what an earlier version of this doc claimed — its `<Item>` block never includes `PictureDetails`/`GalleryURL` no matter the DetailLevel (confirmed against eBay's own docs, which list GetSellerTransactions' limited Item fields explicitly and point to `GetItem` for anything more). `/api/ebay/sales` gets sold-item thumbnails from two places instead: the Supabase `drafts.thumbnail_url` for anything listed through this app (instant, no extra call), and a `GetItem` call per remaining ItemID (concurrency-limited to 5, capped at 60 lookups per page load) for older/manually-listed items with no Supabase row. Note eBay stops returning item details (pictures included) for listings that ended more than ~90 days ago, so some very old sales can still show the placeholder icon — a real eBay limitation, not a bug.
- GetSellerTransactions ModTime cap is 30 days — anything beyond that (up to the 365d cap) uses parallel window calls merged with dedup
- GetMyeBaySelling's `ActiveList` only ever returns *currently active* listings — it never included ended/unsold ones. `/store` now also requests `UnsoldList` (same pagination pattern, independent totals) so "ended without selling" listings are visible too, not just active ones. Sold listings still live only under `/sales` (GetSellerTransactions), not here.
- **Shipping mode is an explicit per-listing seller choice, defaulted from `/settings`, not decided by weight.** `shippingMode: "free" | "buyer_pays" | "calculated"` (`src/lib/shipping.ts`; parsed from request bodies with `parseShippingMode`). Every listing screen (new-listing, batch-upload per item, drafts/[id]) shows a `ShippingModeControl` three-way toggle, initialized from the app-wide default in `app_settings.default_shipping_mode` (fetched via `/api/settings`) but always switchable per item before listing — Settings only offers Free/Calculated as the *default*; "Buyer pays flat" remains available as a per-item override on any screen. This threads into pricing (`computeListAndFloor` in `src/lib/pricing.ts`) and into the actual eBay setup applied:
  - **Free**: `EBAY_SHIPPING_FREE_ID` policy; full estimated shipping cost baked into the item price before grossing up for eBay fees.
  - **Buyer pays (flat)**: `EBAY_SHIPPING_HEAVY_ID` policy with a `shippingCostOverrides` set to the seller-chosen dollar amount; item price only needs to recover the *fee portion* of that shipping charge (buyer fronts the cost itself) — real margin the "free" math would otherwise absorb.
  - **Calculated**: `EBAY_SHIPPING_CALCULATED_ID` policy (a real eBay "cost varies by buyer location" policy — see env var above) plus a `packageWeightAndSize` (weight + box dimensions + `packageType`) attached to the inventory item itself (`upsertInventoryItem` in `src/lib/ebay-inventory.ts`) so eBay can quote each buyer their own real carrier rate at checkout. No dollar override is sent (or possible) for this mode — same fee-only pricing treatment as buyer-pays, using the app's weight estimate as the best available proxy since the real per-buyer charge isn't known ahead of time.
  Both the cost estimate and the calculated-mode package weight/dimensions come from `src/lib/shipping.ts`'s weight-based estimate (`estimateShipping`/`estimatePackage`, from AI-detected item type/size/material against USPS Ground Advantage weight breaks and reasonable per-weight-bracket box sizes) — an estimate, not a measurement, same tradeoff as before.
- All eBay-dependent pages return `connect`/`reconnect` flags for missing/expired token UI
- **eBay Store Categories are AI-suggested, never auto-applied.** Every listing screen (new-listing, batch-upload per item, drafts/[id]) shows a `StoreCategoryControl` dropdown of the seller's real Store categories (from `GET /api/ebay/store-categories`, only leaf categories — eBay silently reroutes items assigned to a parent category to "Other"). During AI analysis, `buildItemVisionPrompt()` (`src/lib/vision-prompt.ts`) is built dynamically with the seller's actual category names spliced in, so GPT-4o-mini picks from a real, current list instead of guessing; the match is shown pre-selected in the dropdown with an "AI suggested" badge (which disappears the moment the seller picks something else — never a silent auto-apply). The choice is saved on the draft (`store_category_id`/`store_category_name` columns) and, once the listing is actually published and has a real eBay ItemID, applied with a best-effort `ReviseFixedPriceItem` call (`setListingStoreCategory` in `src/lib/ebay-store-categories.ts`) — if that call fails, listing still succeeds and a non-blocking `storeCategoryWarning` is surfaced on-screen rather than silently swallowed. Category data is cached in memory for 30 minutes (`fetchStoreCategories`) since `GetStore` is a relatively heavy call and categories rarely change mid-session. Scope: new listings only — this does not retrofit categories onto already-live eBay listings.
- **Rate limiting on the two AI vision endpoints** (`/api/analyze-item`, `/api/analyze-batch`) — 15 requests/minute per IP via Upstash Redis (`@upstash/ratelimit`, `@upstash/redis`), enforced in `src/middleware.ts`. Built defensively: if `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` aren't set, rate limiting is silently skipped rather than crashing every request through middleware — a missing secondary feature should never take down the whole app.
- **Per-user data isolation (Phase 1 of the multi-tenant plan, shipped).** `supabase-migrations/003_multi_tenant_isolation.sql` converted `drafts.user_id` from dead `text default 'default-user'` to a real `uuid` FK against `auth.users(id)`, rewrote RLS on `drafts`/`app_settings`/the `photos` storage bucket to be scoped to `auth.uid()` instead of just "authenticated," and converted `app_settings` from one shared singleton row to one row per user (auto-created on first Settings save via upsert in `/api/settings`). Photo uploads are namespaced by user folder (`src/lib/storage.ts`) to match. **What this does NOT yet cover:** the eBay connection itself is still one shared account (env-var-based OAuth token) — every user still lists into the same real eBay store, and `/dashboard`, `/store`, `/sales`, `/ship` still show identical numbers for every account, since those come live from that one eBay connection. Per-user eBay OAuth is Phase 2, not yet built.
- **No self-service sign-up, still on purpose (for now).** `/login` only offers sign-in, never account creation — see the comment at the top of `src/app/login/page.tsx`. Even with Phase 1's data isolation shipped, sign-up stays closed until Phase 2 (per-user eBay connections) exists too — otherwise every new signup would be listing into the one real owner's eBay store. The two legitimate accounts were created directly in the Supabase dashboard. **The UI change alone is not sufficient** — "Allow new users to sign up" should also be disabled in the Supabase dashboard (Authentication → Sign In / Providers → Email), since that's enforced by Supabase itself and can't be bypassed by calling its REST API directly with the public anon key the way an app-level check could be. Before sign-up ever reopens for real, there also needs to be a decision on cost exposure (OpenAI vision calls have no billing gate yet) — current plan is a per-user monthly analyze-call cap, not an invite-code system.
- **No self-service account deletion.** A `DELETE /api/user/delete` route existed briefly (added by an external tool, never merged) but was intentionally left out: because the `drafts` table has no per-user ownership column, deleting "your own" data there would actually delete everyone's drafts and photos. Don't re-add self-service deletion until per-user data isolation exists.
- **Theming (light/dark/system)** — CSS custom properties (`--bg-page`, `--bg-card`, `--text-primary`, `--danger`, `--warning-bg`, etc. — see `src/app/globals.css`) are defined three times: once on bare `:root` (light, the default), once under `@media (prefers-color-scheme: dark)` scoped to `:root:not([data-theme="light"])` (follows the OS/browser setting when the seller hasn't picked one explicitly), and once under `:root[data-theme="dark"]` (an explicit choice always wins, either direction). The choice is stored in a plain `theme` cookie (`src/lib/theme.ts`) — **not** localStorage — specifically so `RootLayout` (`src/app/layout.tsx`, a server component) can read it with `cookies()` and render the correct `data-theme` attribute into the very first byte of HTML. That avoids the "flash of wrong theme" that localStorage-based approaches need a blocking inline `<script>` in `<head>` to paper over. All page/component styling uses these variables (or literal `var(--brand-*)` from `tailwind.config.js`, which is intentionally theme-invariant — the brand blue stays the brand blue) rather than hardcoded hex colors, so new UI should follow the same pattern instead of reintroducing raw hex.

### Supabase drafts table columns
id, user_id (uuid, FK to auth.users, RLS-scoped — see Phase 1 note above), title, brand, color, size, condition, flaws, suggested_price, avg_sold, sell_odds, thumbnail_url, custom_sku (unique per user_id, not globally), item_type, style, material, theme, sleeve_length, neckline, fit, pattern, description, ebay_listing_id, photo_urls, vintage, character, character_family, year_manufactured, season, store_category_id, store_category_name, created_at

### Supabase app_settings table
One row per user (`user_id uuid primary key references auth.users(id)`, as of Phase 1 — previously a singleton `id=1` row shared by everyone). Columns: `user_id`, `default_shipping_mode` (`'free' | 'calculated'`), `updated_at`. `/api/settings` GET falls back to `"free"` if a user has no row yet; PATCH upserts (`onConflict: "user_id"`) so a brand-new account's first save creates its row.

## Deferred

| Feature | Notes |
|---|---|
| **Stripe billing** | Membership page is UI only — deferred until all features are working |
| ~~**Heavy shipping per-item cost**~~ | Done — `src/lib/shipping.ts` now estimates a real per-item weight and cost from item type/size/material; the dollar field is auto-filled but still user-editable |
| **Supabase leaked-password protection** | Flagged by `get_advisors` (security, `auth_leaked_password_protection`) as disabled. Not settable via any available Supabase MCP tool (it's an Auth/GoTrue service config, not a DB row) — needs the Dashboard: Authentication → Sign In / Providers → Password → enable "Leaked password protection." One click, no code change. |
| **Next.js major-version upgrade (15/16)** | Bumped 14.2.5 → 14.2.35 (patch-only) to close CVE-2025-29927 (middleware auth-bypass — this app's middleware.ts is the primary auth gate) at low risk. `npm audit` still flags ~20 advisories only fixed in 15.x/16.x (mostly Server Actions/RSC-specific — this app uses neither, so exposure is lower than the count suggests) plus a self-hosted Image Optimizer DoS (GHSA-9g9p-9gw9-jx7f, unpatched anywhere in 14.x) — closed instead by setting `images.unoptimized: true` in `next.config.js`, since the app never actually uses `next/image`'s `<Image>` component (all photos render via plain `<img>`). A full 15/16 upgrade needs React 19 + testing across every page and deserves its own session, not a bundled "quick win." |
