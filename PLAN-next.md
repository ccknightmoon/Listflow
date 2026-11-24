# Next round (branch `feat/next-round`, Nov 24, 2026)

One branch, one commit per item, so a single push ships everything. Plain-English notes per item; technical detail is in the commit messages and code comments.

## 1. Parked QA fixes (from `fix/qa-round2`)

`fix/qa-round2` had two commits on top of an older main. The first (QA fixes incl. Home "Last 7 days") was already in main. The second (parked WIP: server stale-while-revalidate caches) was re-applied here by hand, because the list route had since moved into `src/lib/publish-draft.ts`. The cache drop now lives in `publishDraft()`, so the background queue's publishes clear it too.

- **Home "Last 7 days" = Sales → 7 days.** Home now uses the Sales page's own data and dates when it has them (the Sales feed in this tab, else the server's cached copy, sent as `weekSales`), and falls back to its own 28-day pull. While the first numbers load, Home shows a pulsing placeholder instead of "—".
- **Sales refreshes itself.** The server sends its cached copy at once and rebuilds in the background (`stale: true`); the page then quietly asks once more for a copy no older than 3 minutes. While the page is open (and whenever it comes back to the foreground) it re-checks once the data is older than ~12 minutes. Failures during these quiet checks keep the numbers on screen.
- **Faster loads.** Home's eBay summary is now stale-while-revalidate (fresh 2 min, then served instantly for up to 15 min while one refresh runs), so a repeat visit never waits on eBay. Listings and Sales caches are stale-while-revalidate too and are cleared when you list, delist, relist or change a price. `/api/ai-usage` was requested twice per app open (sidebar + bottom nav); now one shared request per minute.
- **Watcher offers:** when a listing has watchers but eBay hasn't made it eligible, the price sheet explains why (eBay decides; usually old watchers or an offer already sent recently), or that Listflow couldn't read the list (reconnect eBay).
- **Small bugs:** one ✕ in search fields (the browser's own was hidden); bulk edit button reads "Pick a change above" / "No items would change" instead of "Apply to 0 items", and disabled buttons look disabled; Home number skeletons; the accent color is applied on a new device without visiting Settings first (`AccentSync`); the draft editor pads itself by the bottom bar's real height, and on desktop the photo column scrolls inside the space above the bar.

Not changed: Settings' own requests (settings, eBay policies, photo storage) are all needed; the rest of the "12 requests" are shared app-wide (jobs sweep, AI usage, Next.js link prefetches).

## 2. Grouping without AI

- **Batch camera** (Batch Upload → "Shoot with the batch camera"): a full-screen live camera in the app. Shoot an item, tap **Next item**, shoot the next, tap **Done**. The first photo of each item is marked "New item starts here", so grouping is exact and free. Each shot is compressed to the same 1024 px and starts uploading immediately. On a computer: Space = shoot, N = next item, Esc = done. If the live camera is blocked or missing, it falls back to the phone's own camera one shot at a time with the same Next item flow. To drop an extra shot, use the review step.
- **Camera-roll uploads are grouped by the pauses between shots** (`src/lib/time-grouping.ts`). The time each photo was taken is read from its EXIF data before compression (`src/lib/exif-time.ts`). Pauses ≤ ~15–30 s = same item, ≥ ~45–60 s = new item (thresholds adapt to your pace). Only the unclear pauses in between get one small AI check each (3 photos either side), run in parallel. If the photos have no usable times (e.g. the phone stripped them), it falls back to the existing AI grouping.
- Order of precedence: ✂ / "New item starts here" marks (incl. the camera's Next item) → divider-shot detection (if on in Settings) → time pauses → AI grouping.
- **Hands off to the server queue**: "Group & analyze in the background" now groups locally first (markers or pauses) and hands each item to the queue as soon as its photos are uploaded; it only falls back to the server's AI grouping when neither works. "Analyze in the background" on the review step is unchanged.
- Not measured yet on Sel's real batches: check how often a pause fools it (merge/split in review) and tell me the typical pace if the thresholds need moving.

## 3. Swipe-to-approve review queue

On **Background batches** (`/batches`), **Review one by one** opens a full-screen queue: one card per finished draft with its photo, title, price and only the flagged fields (the reasons it isn't Ready). Swipe right (or Enter / →) to approve, left (or ← ) to hold it back, E opens the full editor in a new tab, Esc closes. A missing or flagged price can be typed right on the card; it's saved to the draft before approving. The last card is **List all Ready**.

What gets listed: everything you approved, plus everything the server already marked Ready that you didn't hold back. So "List all Ready" on the page and at the end of the queue agree, with or without a review. Decisions are remembered on this device per batch (they survive a reload). Publishing uses the existing background publish jobs (never twice). Approving a "Needs a look" item with other problems (e.g. a required eBay field) can still fail at publish; it then shows "Listing failed — needs a look" with Retry, as before.

## 4. Security

### 4a. eBay Marketplace Account Deletion endpoint

eBay requires every app that stores eBay user data to either subscribe to these notifications or opt out (only allowed if no eBay data is stored, which isn't Listflow's case). Per eBay's page (checked Nov 24, 2026): *"Failure to comply with this requirement will result in termination of your access to the Developer Tools, and/or reduced access to all or some APIs"*, and a callback that stays unacknowledged is marked down after 24 h, with 30 days to fix it before the developer is "non-compliant". So the production keyset is at risk until this is registered.

- `GET /api/ebay/account-deletion?challenge_code=…` answers eBay's check with `sha256(challengeCode + verificationToken + endpoint)` as JSON.
- `POST` verifies eBay's `X-EBAY-SIGNATURE` (public key from eBay's Notification API, cached 1 h), then deletes what Listflow holds for that eBay user: the eBay connection (encrypted token, IDs, policy picks) and eBay-derived history (`sale_costs`, `active_listing_snapshots`). Buyer details are never stored. The Listflow login and the seller's own drafts are kept; the seller is just disconnected. It replies 204 only after the delete succeeds (a failure returns 500 so eBay resends). Bad signatures get 412.
- To match notifications to a seller, Listflow now saves the eBay user ID (and, with **migration 032**, the EIAS token) when eBay is connected, and the daily snapshot cron backfills existing connections (one read-only `GetUser` call per seller).
- Public route, not rate-limited (eBay can send bursts of up to ~1,500/day).
- **Sel's steps** are in the final report (env vars + eBay developer portal).

### 4b. Private photos for unpublished drafts (off until Sel switches it on)

Today every photo is in the public `photos` bucket: anyone with a link can open it. New design, **off by default** so nothing changes until Sel turns it on:

- With `NEXT_PUBLIC_PRIVATE_DRAFT_PHOTOS=1` (Vercel env var) **and migration 033 applied**, new uploads go to a private bucket, `photos-private`. The draft stores a same-origin link, `/api/photos/<userId>/<file>.jpg`. In the app, that link only works for the signed-in owner (it redirects to a 1-hour signed link), so all existing screens show the photos without changes.
- **eBay and OpenAI still get readable URLs**: right before sending, the server swaps these links for signed Supabase URLs (1 hour for OpenAI, 1 day for eBay, which copies the pictures when the listing is created). Only the owner's own links are ever signed. Covered: Analyze & list / batch analysis (`/api/analyze-batch`), the server queue (grouping, analysis, image-search pricing), publish (route and queue).
- **Existing photo URLs are untouched** and keep working; old and new drafts can be mixed.
- Photo storage cleanup and the account purge handle both buckets. (Fixed on the way: the account purge only ever deleted the first 100 photos.)
- Not covered: the orphan sweep only looks at the public bucket.

### 4d. Migration 024

Checked the live database (read-only): `public.set_updated_at` still has no fixed `search_path`, so **024 is not applied**. The file is ready as-is (`supabase-migrations/024_set_updated_at_search_path.sql`, one safe `alter function`, reversible). Needs Sel's approval.

### 4c. Weekly backup

No new cron (the free plan's two are used): the existing daily snapshot cron runs the backup when the last one is about a week old. It saves the key tables (drafts, app_settings, ebay_connections with the token still encrypted, sale_costs, active_listing_snapshots, ai_usage_counters) as one gzipped JSON file in a private `backups` storage bucket (created automatically; only the server can read it; newest 8 kept). If `BACKUP_EMAIL_TO` is set in Vercel, the same file is emailed (off-site copy that survives losing the Supabase project). Photos aren't included (too big; published ones live on eBay). This is a safety net, not a replacement for Supabase Pro's daily backups. To run one right away: call the snapshot cron with `?backup=now` (needs `CRON_SECRET`).

### 4e. Server-side input validation sweep

New shared checks in `src/lib/input-validation.ts`, applied where the gaps were:
- **Drafts create/update** (`POST /api/drafts`, `PATCH /api/drafts/[id]`; also the queue's draft writer through `draftBodyError`): text fields must be text (no objects) with generous length caps; prices must be numbers 0–100,000; `ebayListingId` must be an eBay item number (before, any string could be saved, which could fool the "already listed" guard); photos must be up to 24 web links (or private-photo links; never data: or javascript:); item specifics capped in size. Bad draft IDs return 404 before touching the database.
- **Bulk delete** (`DELETE /api/drafts`): IDs must be 1–500 UUIDs.
- **AI routes** (`analyze-batch`, `analyze-item`, `group-photos`, `detect-item-dividers`): image lists checked for count, shape, type and size before any AI usage is counted.
- **Pricing** (`/api/pricing/suggest`): bad JSON now returns 400 instead of crashing with 500.
Already fine (checked): eBay price/offer/message/relist/delist routes, settings, sales costs, the queue routes.

## 5. Pricing suggestions from comparable active listings

In the draft editor, under List price: **Compare with active listings**. It searches eBay (Browse API: text search, plus a search by the first photo) for similar fixed-price items for sale now, then weights each one by how alike it is: same brand, same size (handles M/Medium, 32x30/W32 L30, etc.), new vs used, and title overlap. Free-shipping prices have our shipping estimate taken off (their price includes it). Extreme prices (lots, typos) are dropped.

It shows a **range** (weighted 25th–75th percentile), a **typical** price (weighted median), a **confidence** (high / medium / low, from how many close matches there are and how spread out they are), and the 5 closest listings with links. "Use $X" only fills the price box; you still save. Nothing changes prices automatically, and the existing pricing estimate is unchanged.

Honest limit, also shown on screen: these are **asking prices of items still for sale, not sold prices**. eBay only gives sold prices to apps approved for its Marketplace Insights API, which Listflow doesn't have, and things often sell for less than they're listed at. Uses the screen's current title/brand/size/condition (even unsaved). Rate-limited like the other pricing call.
