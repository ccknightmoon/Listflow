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
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only; required by account deletion

## What's Built

### Pages
- `/` — Landing/splash page
- `/login` — Supabase sign-in/sign-up
- `/dashboard` — Live stats (drafts, active listings, weekly revenue + sold count) + quick action cards. "To ship" card shows urgent badge when items are awaiting shipment.
- `/new-listing` — Single item flow: 3-photo slots (front, measurements, flaws) → AI analysis + live pricing in parallel → save draft / list on eBay
- `/batch-upload` — Multi-item workflow: upload → AI photo grouping → manual review → bulk analysis → results with bulk list/save actions
- `/drafts` — Unlisted drafts with thumbnails, pricing info, no-price warning, bulk delete, bulk list with price guard
- `/drafts/[id]` — Edit draft, AI suggest specifics, re-analyze with new photos, list / relist on eBay
- `/store` — All active eBay listings (Supabase + eBay merged). Search, sort, inline price edit, bulk price update, delist.
- `/sales` — Sales history with 7d/30d/90d toggle, total revenue, per-item thumbnails
- `/ship` — Items paid but not yet shipped: buyer name/address, days-since-payment badge, Ship → link to eBay order
- `/membership` — Pricing plans UI only (Stripe deferred)

### API Routes
- `POST /api/analyze-item` — GPT-4o-mini vision, 1–3 photos; returns itemType, brand, color, size, condition, flaws, title, style, material, pattern, fit, vintage, theme, character, yearManufactured, season, description, and measurements (pitToPit, length, waist, inseam read from measuring tape in photo)
- `POST /api/analyze-batch` — Sequential batch analysis with rate limit handling and retry logic
- `POST /api/group-photos` — GPT-4o clusters mixed uploaded photos into per-item groups
- `GET|POST|DELETE /api/drafts` — Supabase CRUD for saved drafts
- `GET /api/drafts/[id]` / `PATCH /api/drafts/[id]` / `DELETE /api/drafts/[id]`
- `POST /api/ai/suggest-specifics` — fills eBay item specifics from existing draft fields
- `POST /api/pricing/suggest` — live pricing via eBay Browse API (image search → text fallback → condition-adjusted median)
- `GET /api/ebay/ship` — paid-but-unshipped orders from GetSellerTransactions
- `GET /api/ebay/sales?days=7|30|90` — sales history (multi-window for 90d eBay cap)
- `GET /api/ebay/store` — active listings via GetMyeBaySelling
- `GET /api/ebay/inventory` — Supabase-sourced listings (instant load for store page)
- `POST /api/ebay/list` — full listing flow: upsert inventory → create/update offer → publish
- `POST /api/ebay/delist` — end listing, clear from Supabase
- `POST /api/ebay/update-price` — ReviseFixedPriceItem + update Supabase
- `GET /api/ebay/connect` / `GET /api/ebay/callback` — OAuth flow
- `GET /api/dashboard/stats` — aggregated stats for dashboard

### Notable Implementation Details
- **node:https for all eBay + OpenAI calls** — Next.js 14 patches `globalThis.fetch` which breaks repeated outbound HTTPS. All external API calls use `node:https` directly. Every route using it must export `runtime = "nodejs"`.
- **eBay Trading API URL**: `https://api.ebay.com/ws/api.dll` (not `/ws/services`)
- Client-side image resizing before upload (max 1568px) to reduce API token cost
- Batch upload uses explicit step state machine: `upload → grouping → review → analyzing → results`
- Sequential (not parallel) batch processing to respect OpenAI rate limits; 3 retries with 15s delay on rate-limit errors
- AI measurements injected as first line of `description` field — not stored as separate DB columns
- GetSellerTransactions requires `<DetailLevel>ReturnAll</DetailLevel>` to return GalleryURL
- GetSellerTransactions ModTime cap is 30 days — 90d history uses parallel window calls merged with dedup
- Shipping *policy* is still binary at the eBay level (free (`EBAY_SHIPPING_FREE_ID`) or heavy (`EBAY_SHIPPING_HEAVY_ID`) flat rate), but the *cost estimate* shown to the user and fed into pricing math (`src/lib/shipping.ts`) is now a real weight-based estimate — derived from AI-detected item type/size/material against USPS Ground Advantage weight breaks — not a flat guess
- All eBay-dependent pages return `connect`/`reconnect` flags for missing/expired token UI

### Supabase drafts table columns
id, title, brand, color, size, condition, flaws, suggested_price, avg_sold, sell_odds, thumbnail_url, custom_sku, item_type, style, material, theme, sleeve_length, neckline, fit, pattern, description, ebay_listing_id, photo_urls, vintage, character, character_family, year_manufactured, season, created_at

## Deferred

| Feature | Notes |
|---|---|
| **Stripe billing** | Membership page is UI only — deferred until all features are working |
| ~~**Heavy shipping per-item cost**~~ | Done — `src/lib/shipping.ts` now estimates a real per-item weight and cost from item type/size/material; the dollar field is auto-filled but still user-editable |
| **Supabase leaked-password protection** | Flagged by `get_advisors` (security, `auth_leaked_password_protection`) as disabled. Not settable via any available Supabase MCP tool (it's an Auth/GoTrue service config, not a DB row) — needs the Dashboard: Authentication → Sign In / Providers → Password → enable "Leaked password protection." One click, no code change. |
| **Next.js major-version upgrade (15/16)** | Bumped 14.2.5 → 14.2.35 (patch-only) to close CVE-2025-29927 (middleware auth-bypass — this app's middleware.ts is the primary auth gate) at low risk. `npm audit` still flags ~20 advisories only fixed in 15.x/16.x (mostly Server Actions/RSC-specific — this app uses neither, so exposure is lower than the count suggests) plus a self-hosted Image Optimizer DoS (GHSA-9g9p-9gw9-jx7f, unpatched anywhere in 14.x) — closed instead by setting `images.unoptimized: true` in `next.config.js`, since the app never actually uses `next/image`'s `<Image>` component (all photos render via plain `<img>`). A full 15/16 upgrade needs React 19 + testing across every page and deserves its own session, not a bundled "quick win." |
