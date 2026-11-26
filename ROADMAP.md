# Listflow roadmap (Nov 26, 2026)

Planning only. Nothing in the code, on eBay, or in the live database was changed to write this. Branch: `docs/roadmap`.

Who it's for: Sel, a one-person eBay reseller (secondhand/vintage clothing, rag-house sourcing, Miami 33125). The goal: every item goes from rag-house bag to sold and shipped with as few taps, as little waiting, and as much profit as possible, in a way that still works later when other sellers join.

Effort: **S** = under half a day · **M** = 1–2 days · **L** = 3+ days. Impact: ★ (low) to ★★★★★ (high).

---

## 1. Where the app is today (audit)

### 1.1 The real workflow, step by step

| # | Step | What Listflow does now | Friction left |
|---|---|---|---|
| 1 | **Source** (rag house, bins) | Nothing. | Nothing records what each item cost or where it came from. **0 of the 8 drafts in the live database have a cost**, so profit per item can't be calculated. |
| 2 | **Photograph** | Batch camera with "Next item" (exact grouping, free), or camera-roll photos grouped by the pauses between shots (EXIF time). Photos are compressed to 1024 px and upload right away. | Works online only. A weak signal at the rag house or in the garage stalls uploads. Nothing tells you which shots are missing (tag, flaw, tape). |
| 3 | **Group** | Markers → divider shots → time pauses → AI fallback. | Good. The AI fallback still runs one call after another (~4–6 min for 450 photos) when it's needed. |
| 4 | **AI fill** | gpt-4o-mini vision. A cheap pass picks which photos to read at full detail. Category and item specifics come from eBay's category data, then a second pass fills them in. Runs on the server queue or 6 items at a time in the page. | About 1–2¢ per item (estimate: 2 full-detail + 4 low-detail images and about 2,000 text tokens on 4o-mini). **Only the first 6 photos of each item are analyzed** (`MAX_PHOTOS_PER_ITEM = 6`), so tag photos at positions 7–10 can be missed. The app doesn't learn from Sel's edits, so the same fixes come back on every batch. |
| 5 | **Price / floor** | Weight-based shipping estimate, eBay fee gross-up, editable price and Best Offer floor, and "Compare with active listings" (eBay Browse API, weighted). | Compares **asking prices, not sold prices** (eBay's sold-price API, Marketplace Insights, is restricted). No "price from my own sold history". |
| 6 | **Review** | Swipe review queue showing only flagged fields, List all Ready, Check with eBay (Verify). | Still the biggest time cost (~30–60 s per item, from PLAN-volume). It only gets faster when the AI gets fewer fields wrong. |
| 7 | **List** | Publishes through the Trading API from the background queue. Also scheduled listings, store intro, store category and size mapping. | Good. |
| 8 | **Sync** | Read-only eBay sync (GetSellerEvents) every 5 min while the app is open. A GitHub Action can sync every 10 min (**off until `EBAY_SYNC_ENABLED` + `CRON_SECRET` are set**). Daily Vercel cron. | When the app is closed and the GitHub Action is off, a sale may not show up until the daily cron runs. |
| 9 | **Offers / messages** | Pending offers (accept, decline, or counter with presets), buyer questions with reply, and offers to watchers through the Negotiation API (manual, one item at a time). | No **automatic** offers to watchers, no AI-drafted replies, no saved reply templates. |
| 10 | **Sold** | Sales page built from eBay Finances (exact ledger); Home shows the last 7 days. | Profit per item is empty because costs are missing. The "Add costs" fallback for sales without a draft needs the `sale_costs` table, and **migration 025 isn't applied, so that table doesn't exist**. |
| 11 | **Ship** | To-ship list with buyer, address, days since payment, and a link to the eBay order. | No pick list by SKU or bin, no packing slip, no label purchase (eBay's label API, the Logistics API, is whitelist-only), no tracking upload. |
| 12 | **Relist / markdown** | Stale flag at 30 days, manual price cuts (presets, protected by floor and cost), relist for ended items. | Nothing runs on a schedule: no automatic price-drop ladder, no eBay markdown sales, no promoted listings, no "end and sell as new" refresh. |
| 13 | **Bookkeeping** | Ledger matched to eBay payouts; sales CSV. | No cost of goods sold (COGS) per item, no sourcing ROI, no yearly tax export (Schedule C style), no mileage or supplies log. |

### 1.2 Measured and observed (Nov 26, 2026)

- **Production** is running `07232dc` (upgrade-v2b). **Vercel showed no runtime errors in the last 7 days.** The Hobby plan keeps runtime logs for only 1 hour, so older warnings can't be read.
- **Supabase security advisors:**
  - *Leaked password protection disabled* (WARN; needs the Pro plan).
  - RLS is on but there are no policies on `ebay_metadata_cache` and `login_attempts` (INFO). This is on purpose: only the server's service role uses them.
- **Supabase performance advisors:** 3 foreign keys without an index (`batch_job_items.draft_id`, `batch_job_items.user_id`, `listing_jobs.draft_id`) and 7 unused indexes. With this little data it doesn't matter yet; it's a cheap cleanup to do before more sellers join.
- **Migrations:** 024, 032–038 are applied. **025 (`sale_costs`) and 039 (billing) are not.** 025 blocks "Add costs" for sales that weren't listed through Listflow.
- **Storage:** the `photos` bucket holds **650 files (292 MB)** and `photos-private` holds 82 files (36 MB), for only **8 drafts**. That's about a third of the free 1 GB. Photo cleanup is on (3 days, orphans on, last ran Nov 25), yet most files are still there. **Worth finding out why the cleanup isn't freeing space.** Possible causes: the orphan sweep only checks some folders, or trash and batch-job rows still point at the files.
- **Frontend:** the largest JavaScript chunks were ~73 KB and ~67 KB gzipped in the last local build (Oct 21); a fresh build is needed for current numbers. `batch-upload/page.tsx` is 3,842 lines. It works, but it's the hardest screen to change safely.
- **eBay permissions (OAuth scopes):** today the app has `api_scope`, `sell.inventory`, `sell.account.readonly` and `sell.finances`. The features below also need `sell.marketing` (markdowns, promoted listings), `sell.analytics.readonly` (views, impressions) and `sell.fulfillment` (orders, tracking upload). Adding them takes one "Reconnect eBay" tap.
- **Plan limits:** Vercel Hobby is for non-commercial use only, and its crons run at most once a day. Supabase Free has no backups and pauses when idle (it has paused before).

### 1.3 What competitors offer

| Tool | Price (approx.; check their sites) | What sellers rely on it for |
|---|---|---|
| **Vendoo** | Free tier, then ~$9–$150/mo | Crosslisting to ~11 sites, auto-delist when sold, bulk tools, analytics |
| **List Perfectly** | ~$29–$249/mo | Crosslisting, Google Lens pricing, bulk editing, inventory sync |
| **Crosslist** | ~$30–$45/mo | Browser-extension crosslisting, AI fill, auto-delist |
| **PrimeLister** | n/a | Poshmark automation (sharing, offers), crosslisting |
| **Flyp** | Free or low cost | Crosslisting, Poshmark bot (shares, offers), bulk relist |
| **Closo** | Free or ~$99/yr | AI pricing, automatic offers, sharing on Poshmark, Mercari and Depop |
| **eBay Magical Listing / bulk tool** | Free, built into eBay | Photo → draft (title, category, specifics, price); bulk drafts from hundreds of photos in Seller Hub; visual identification added Nov 2026 |

What this means for Listflow:

1. eBay's own free AI listing is now good enough for many sellers. Listflow has to win on **what happens before and after the listing**: grouping at volume, accuracy on vintage tags and sizes, offers, markdowns, profit and shipping.
2. The paid tools win on **automation that runs while you sleep** (auto-delist, automatic offers, re-sharing) and on **crosslisting**.
3. No one handles **sourcing ROI per rag-house trip** well. That's a real opening for a clothing reseller.

---

## 1.4 Competitor gaps (studied Nov 26, 2026)

Sources: Trustpilot, eBay Community, Value Added Resource, vendor pricing/comparison pages (vendor blogs are biased; treated as hints, not facts). Reeva and OneShop had too little public information to judge.

| Tool | Top weaknesses for a solo clothing/vintage seller | How Listflow beats it |
|---|---|---|
| **Vendoo** (free → ~$150/mo, priced by new items/month) | Auto-delist and sync failures reported at volume (sold items left live elsewhere); marketplace connections drop and need reconnecting; add-ons cost extra; billing/cancellation complaints. | eBay-first two-way sync with a visible "Synced X min ago" and a "live on eBay but not in Listflow" alert; flat plans, no per-item credits; no fragile multi-site connections to babysit. |
| **List Perfectly** (~$29–$249/mo) | Auto-delist only on the top tier (~$249), needs a computer + Chrome extension running, quantity = 1 only; crosslisting opens one tab per site to click through. | Everything runs server-side (no laptop left on). Automations (offers, markdowns) on the normal plan. Phone-first. |
| **Crosslist** (~$30–$45/mo) | Browser-extension form-filler; AI fill is generic, not tuned to vintage tags/sizing; no profit or sourcing view. | Vintage-tuned AI (tag/size mapping, Lacoste-style brand sizes), reads every photo, learns your fixes; haul cost → profit per item. |
| **PrimeLister** (Posh $25 + eBay $15/mo per store) | Desktop-only Chrome extension (nothing from the phone); crosslisting basic; eBay bot is offers + relist only; no AI listing, no central inventory. | Phone-first PWA, AI listing + inventory + offers in one app; offers respect floor **and** cost. |
| **Flyp** (~$9/mo) | 6 sites only, little automation, sync stability complaints, basic AI. | Deeper eBay automation and accuracy instead of breadth. |
| **Closo** (free crosslisting; paid tiers sell wholesale perks / take commissions) | Revenue model leans on commissions/sourcing; weak native app (per competitors). | No commission on sales, ever. Sourcing ROI per rag-house trip built in. |
| **eBay Magical Listing** (free, in the eBay app) | Forced photo-first flow sellers can't turn off; misidentifies items and **puts clothing in wrong size types** (blocks listing); corrections take "3× longer"; one photo → can miss tag shots; no profit/aging/after-sale tools. | Listflow already validates Size against eBay's real list and maps brand sizes; Phase 1 reads **all** photos and escalates hard items to a stronger model; the seller stays in control (nothing forced). |
| **eBay native automated offers** (Active Listings → Send offers → "Send automated offers"; Store subscribers can automate by category/price) | A flat % for everything you select; doesn't know your cost or floor, and doesn't change with item age. | Listflow offers are **per-item, floor- and cost-aware**, can deepen with age, and are logged. **Warning shown in Settings:** don't run both on the same listings (buyers would get two offers). |
| **New 2026 entrants** (Sell AI, Trendy Lister: photo → listing apps) | Generic "snap and list"; no batch grouping, no profit, no after-sale. | Batch camera + grouping at rag-house volume, then profit, markdowns, pick lists. |

**What this changes in the plan**

1. **Keep "profit per haul" (D1/D2) as #1.** No competitor does sourcing ROI per trip; it's Listflow's clearest niche.
2. **Automatic offers (B1) stays in Phase 1, but positioned as "smarter than eBay's own".** eBay now has free automated offers, so Listflow's version must add what eBay lacks: never below floor/cost, age-based %, a log, and a clash warning. Off by default.
3. **Reliability is a selling point.** The most common complaint across every crosslister is sync/delist failures. Phase 3's tests + monitoring and the "synced X min ago" signal matter more than adding sites.
4. **Accuracy (A1 all photos, A4 learn my fixes, A10 hard-item model) moves up inside Phase 1** — eBay's free AI is the main competitor and its weak spot is accuracy on clothing sizes/types.
5. **Crosslisting stays "copy-ready helpers only"** (no bots), and must ship with delist reminders — the exact failure users hate in Vendoo/List Perfectly.
6. **Phone-first, nothing to leave running.** PrimeLister and List Perfectly need a desktop + extension; Listflow's automations run on the server on a schedule.

Sources: https://www.trustpilot.com/review/vendoo.co · https://www.voolist.com/blog/voolist-vs-list-perfectly · https://listperfectly.com/selling/list-perfectlys-auto-delist/ · https://blog.vendoo.co/primelister-review · https://blog.vendoo.co/crosslist-vs-flyp · https://flowlister.com/vs-closo/ · https://www.valueaddedresource.net/ebay-ai-magical-listing-complaints/ · https://www.ebay.com/sellercenter/resources/seller-updates/timeline/automated-offers · https://apps.apple.com/app/id6758883858 · https://apps.apple.com/us/app/-/id6773644047

---

## 2. Roadmap by area

Each item lists what it is, why it helps, effort, what it depends on, and cost.

### (A) Speed and efficiency

| # | Item | What it is (plain English) | Why it helps | Effort | Depends on | Cost | Impact |
|---|---|---|---|---|---|---|---|
| A1 | **Analyze all photos, not just 6** | The cheap pass looks at every photo (low detail) and picks 3–4 to read at full detail, so tag and care-label shots at positions 7–10 get read. | Fewer wrong sizes, brands and materials, so less review time. | S | none | +~0.5¢/item | ★★★★ |
| A2 | **Offline capture** | The batch camera saves shots on the phone (IndexedDB) when there's no signal and uploads them by itself when the signal is back. | Shoot at the rag house or in a dead-zone garage without stalls or lost photos. | M | service worker (exists) | none | ★★★★ |
| A3 | **Turn on the 10-minute background sync** | Set `EBAY_SYNC_ENABLED=true` and `CRON_SECRET` in GitHub. The code is already built. | Sales, ended listings and edits made in the eBay app show up within 10 min, even when Listflow is closed. | S (config) | none | free | ★★★ |
| A4 | **"Learn my fixes"** | Listflow remembers Sel's corrections and applies them to new items. Examples: brand "Polo RL" → "Polo Ralph Lauren", always "Men's", preferred title order, default condition wording. | The same edit stops coming back, and review keeps getting faster. | M | none | none | ★★★★ |
| A5 | **Shot checklist in the camera** | While shooting, small chips show Front ✓ Back ✓ Tag ✗ Flaw ✗ Tape ✗, from a quick on-phone check. | Fewer "Needs a look" items caused by a missing tag photo. | M | A1 helps | none | ★★★ |
| A6 | **Voice notes per item** | Hold to talk ("pit to pit 22, small hole left cuff, 1990s") and the AI adds it to the item. | Faster than typing measurements and flaws, and your hands stay free. | M | none | ~0.1¢/item (speech-to-text) | ★★★ |
| A7 | **Parallel AI grouping fallback** | When there are no markers or time gaps, group in overlapping chunks at the same time instead of one call after another. | Big camera-roll batches group in about 1 min instead of 4–6 min. | M | none | same | ★★ |
| A8 | **Push notification when a batch is ready** | A phone notification: "23 items ready to review". | Start a batch, walk away, and come back when it's ready. | M | service worker | free | ★★ |
| A9 | **Split up the batch-upload screen** | Break the 3,842-line page into smaller parts. Nothing changes on screen. | Fewer bugs and safer changes on the most-used screen. | L | tests (exist) | none | ★★ |
| A10 | **Stronger AI model, only on hard items** | Use gpt-4o (or newer) only when confidence is low or the item is branded or vintage. The benchmark page already compares models. | Better accuracy where it matters, for pennies. | S | benchmark (exists) | ~+2–4¢ on maybe 20% of items | ★★★ |

### (B) Listing quality and sales

| # | Item | What it is | Why it helps | Effort | Depends on | Cost | Impact |
|---|---|---|---|---|---|---|---|
| B1 | **Automatic offers to watchers** | Once a day, for every listing with watchers that eBay marks eligible, send an offer at X% off (default 10–15%), never below the floor or the cost. Logged, with an off switch. Uses the Negotiation API code already in the app. | Watchers are the warmest buyers, and offers to them are one of eBay's best-converting tools. Today it's done by hand, one item at a time. | M | daily cron (exists); floors (exist) | free | ★★★★★ |
| B2 | **Price-drop ladder for stale items** | A rule such as: 30 days with no sale → −10%; 45 days → −15%; 60 days → offer to watchers, or end and relist as new. The price never goes below the floor or the cost. Either a weekly preview you approve with one tap, or fully automatic. | Old stock turns into cash without Sel having to remember it. | M | price-cut code (exists); costs (D1) | free | ★★★★★ |
| B3 | **eBay markdown sales (strikethrough prices)** | Instead of quietly lowering prices, run an eBay "Sale" (Marketing API `item_price_markdown`). Buyers see "was $40, now $32" with sale badges. Up to 500 items per sale. | Strikethrough prices sell better than silent cuts, and the original price comes back afterward. | M | `sell.marketing` (reconnect) | free | ★★★★ |
| B4 | **Promoted listings, with a cap** | Put new listings in a general campaign at a low fixed rate (e.g. 2–4%) or eBay's suggested rate, with a cap. Raise the rate only on stale items. The ad fees show up in profit. | More views. The fee is only charged when the item sells through the ad. | M | `sell.marketing`; D1 for the profit view | ad fee only on ad sales | ★★★★ |
| B5 | **Views and impressions per listing** | Pull eBay's traffic report (impressions, click-through rate, views) into Inventory. Flag "many views, no sale → price problem" vs "few views → title or photo problem". | Shows *why* an item is stuck, so you apply the right fix (price vs title). | M | `sell.analytics.readonly` (reconnect) | free | ★★★★ |
| B6 | **Price from my own sold history** | When a new item looks like something Sel already sold (same brand, type, era), show "You sold 3 like this for $28–$35 in ~12 days". | Real **sold** prices from Sel's own data, which the restricted sold-price API can't give. | M | ledger + drafts (exist) | free | ★★★★ |
| B7 | **Title and keyword score** | Score each title on how well it uses the 80 characters (brand, era, type, size, color, material, words buyers search for), and suggest missing words from the closest active listings. | Better search placement at no extra cost. | S | seo-title code (exists) | none | ★★★ |
| B8 | **Better main photo** | Optional auto-crop, straighten and brighten of the first photo. No fake backgrounds, so the condition stays honest. | The thumbnail is what gets the click. | M | none | small (image API) or free on the phone | ★★ |
| B9 | **Volume pricing and Best Offer automation** | Volume pricing only works for listings with more than one of the same item, so it doesn't fit one-of-a-kind clothes; skip it. Best Offer auto-decline already follows the floor. Add an "auto-accept offers above X%" setting. | Fewer offers to handle by hand. | S | floors (exist) | free | ★★ |
| B10 | **"Sell similar" from a sold item** | One tap on a sold item creates a new draft with the same specifics and description; you add new photos and a SKU. The duplicate API already exists. | Restock a winner in seconds. | S | duplicate API (exists) | none | ★★ |

### (C) After the sale

| # | Item | What it is | Why it helps | Effort | Depends on | Cost | Impact |
|---|---|---|---|---|---|---|---|
| C1 | **Bin or shelf location + pick list** | Add a "Bin" field (e.g. "B3"), set during review and remembered for the rest of the batch. The To-ship screen becomes a pick list sorted by bin, with SKU, photo and size, plus printable packing slips. | No digging through piles, which matters more and more as inventory grows. | M | migration (one column) | none | ★★★★★ |
| C2 | **Shipping labels: the realistic path** | eBay's label API (Logistics) is whitelist-only (USPS, approved partners), so buying labels inside Listflow isn't possible yet. **Short term:** a one-tap link to eBay's own "Print shipping label" page for each order, with the weight and box size Listflow already estimated shown so you can copy them. **Long term:** apply for Logistics access, or connect a label service (Shippo or EasyPost) and upload tracking through the Fulfillment API. | Fewer taps per order now; real in-app labels later. | S (link) / L (label service) | `sell.fulfillment` for tracking upload | Shippo/EasyPost per-label fees | ★★★★ |
| C3 | **AI reply drafts for buyer questions** | For each buyer message, draft a reply from the listing's details (measurements, flaws, shipping); tap to edit and send. Plus 5 saved templates ("Measurements", "Combined shipping", "Holiday shipping"). | Faster answers mean more sales, and eBay rewards quick responses. | S–M | messages (exist) | ~0.1¢/reply | ★★★★ |
| C4 | **Instant sale alerts** | Use eBay's push notifications for "item sold" (Notification API or Platform Notifications) so a sale reaches Listflow within seconds, then send a phone notification: "Sold: Lacoste polo $34 — bin B3". | Same-day shipping, a protected "fast handling" record, and crosslisted copies taken down quickly (see E). | M | changes eBay notification settings (needs Sel's OK) | free | ★★★ |
| C5 | **Automatic feedback** | Easiest path: turn on eBay's own automatic positive feedback in Seller Hub (no code). Optional: a reminder list in Listflow. | One chore gone. | S (setting) | none | free | ★ |
| C6 | **Returns and cancellations view** | Read open return and cancellation requests (Post-Order and Fulfillment APIs) and show them on Home with their deadlines. Acting on them stays in eBay. | A missed return deadline hurts seller standing. | M | new scopes; BACKLOG notes eBay's docs are unclear | free | ★★ |

### (D) Business insights

| # | Item | What it is | Why it helps | Effort | Depends on | Cost | Impact |
|---|---|---|---|---|---|---|---|
| D1 | **Cost and source at intake ("the haul")** | Start each batch with "Haul: Rag house X, Nov 26, paid $120 for 40 lb / 60 pieces". Listflow splits the cost across the items (evenly, by weight, or by price) and tags every item with its source. Also apply migration 025. | This is what makes real profit per item, sourcing ROI and taxes possible. Today **0 items have a cost**. | M | migration (haul table + `source_id` on drafts); 025 | none | ★★★★★ |
| D2 | **Profit per item and per haul** | Profit = sale price − eBay fees (exact, from Finances) − ad fees − shipping label − item cost. Shown per item, per haul ("Nov 12 rag-house trip: $120 in → $612 out so far, 41% sold") and per brand or type. | Shows which rag houses, which bags and which brands are worth buying. | M | D1 | none | ★★★★★ |
| D3 | **Aging inventory board** | Groups by age (0–30, 31–60, 61–90, 90+ days), shows how much money is tied up in each, and gives one-tap actions (markdown, send offers, end and relist as new). | Dead stock becomes a to-do list. | S | B1/B2 for the actions | none | ★★★★ |
| D4 | **Sell-through and days to sell** | Sell-through % by category, brand, size and source; average days to sell; best and worst months. | Guides what to pick at the rag house (works with the seasonal sourcing skill). | S | D1 | none | ★★★ |
| D5 | **Tax-ready export** | A yearly (and quarterly) export: gross sales, refunds, eBay fees, ad fees, shipping, COGS per item, plus a supplies and mileage log. Schedule C-friendly CSV and PDF. It's prep material for a CPA, not tax advice. | Tax time takes minutes, and quarterly estimated payments can be planned. | M | D1; ledger (exists) | none | ★★★★ |
| D6 | **Weekly business email** | A Monday edition of the daily digest: items sold, profit, best haul, aging items, and actions waiting. | One look shows how the week went. | S | D2 | free | ★★ |

### (E) Cross-listing to Poshmark, Mercari and Depop

What's actually allowed (checked Nov 2026; check each site's current terms before building):

| Platform | Official seller listing API? | How competitors do it | Risk | Recommendation |
|---|---|---|---|---|
| **Poshmark** | No public API. | Browser extensions that fill in Poshmark's web forms using the seller's own login. | Poshmark's terms forbid bots that share and follow; form-filling extensions are a grey area. Accounts can be restricted. | **Don't automate.** Add a "Copy for Poshmark" button (title, description, a price that covers Posh fees, photos to download) and a link. Sel posts by hand. |
| **Mercari** | No public listing API. Mercari has **its own cross-listing import tool** (help center article 609). | Extensions, or Mercari's own import. | Low when using Mercari's import. | **Use Mercari's import** where it fits, plus a "Copy for Mercari" button. |
| **Depop** | A partner/business API reportedly exists (Crosslist says it has official access), but it isn't open to everyone. | Partner API or extensions. | Low with the partner API; unknown otherwise. | **Apply for Depop partner access** later; until then, a copy-ready export. |
| **Any of them** | — | Auto-delist when the item sells on eBay. | Selling one physical item twice means a cancellation and a defect on your account. | Required **before** any crosslisting: when C4 sees a sale, immediately show "Remove from Posh/Mercari/Depop" with links. |

Effort: copy/export helpers **S–M**; Depop API **L** (after approval); browser extensions **not recommended**. Per-platform prices use the cross-listing advisor's fee math. Impact: ★★★ (more buyers for vintage on Depop and Poshmark, but more work per sale). Do this after A–D.

### (F) Reliability, security and scale

| # | Item | What it is / why it matters | Effort | Cost | Impact |
|---|---|---|---|---|---|
| F1 | **Supabase Pro** | Daily backups and point-in-time restore, no auto-pause, leaked-password protection (clears the WARN advisor), 100 GB storage. Already a must-do in LAUNCH-READINESS. | S | $25/mo | ★★★★★ (needed before other sellers; strongly advised now) |
| F2 | **Vercel Pro** | Commercial use allowed (Hobby isn't), crons every few minutes (replaces the GitHub Action), 1 day of logs, longer function run time. | S | $20/mo | ★★★★ |
| F3 | **Fix photo storage growth** | Find out why 650 photos are kept for 8 drafts despite cleanup, then fix the sweep for both buckets. | S–M | none | ★★★ |
| F4 | **Apply pending migrations** | 025 (`sale_costs`), plus indexes for the 3 foreign keys. Apply 039 only when billing is turned on. | S | none | ★★★ |
| F5 | **Uptime checks and alerts** | An outside uptime check on `/`, a `/api/health` route that pings Supabase and eBay, and Sentry alerts for new issues and error spikes. | S | free tiers | ★★★ |
| F6 | **Turn on rate limiting** | Set `RATE_LIMIT_ENABLED=1` and the Upstash variables (the code is ready and lets traffic through if Redis is down). Add a Turnstile check on signup before launch. | S | free tier | ★★ (★★★★ before launch) |
| F7 | **eBay call budget and Growth Check** | Track daily eBay API calls per seller, and apply for eBay's Application Growth Check before many sellers join. | M | free | ★★ now / ★★★★ at launch |
| F8 | **Staging environment** | A second Supabase project plus a Vercel preview using eBay sandbox keys, to test migrations safely. | M | ~$0–25/mo | ★★★ |
| F9 | **End-to-end tests** | Automated Playwright runs of the main paths in CI: shoot → review → list (eBay sandbox), and sale → profit. 913 unit tests exist, but nothing tests the whole flow. | M | free | ★★★ |
| F10 | **Plan the move off older eBay calls** | GetSellerTransactions and GetMyeBaySelling still work (the deprecation test watches them). Plan the move to the Fulfillment API and `sellerListingSearch` well before any shutdown date. | M | free | ★★ |

### (G) Growth and SaaS

| # | Item | What it is / why it matters | Effort | Depends on | Impact |
|---|---|---|---|---|---|
| G1 | **3-step onboarding** | Connect eBay → pick policies (suggested automatically) → list a first item from a sample photo; helpful empty screens everywhere. | M | none | ★★★★ (at launch) |
| G2 | **Pricing tiers (already coded, switched off)** | Free (manual), Pro $29, Power Seller $59, helper seats $10. Pitch against Vendoo and List Perfectly as **"profit + automation for clothing resellers"**, not on number of crosslisting sites. Add an annual discount. | S to switch on | F1, F2, 039, Stripe live | ★★★★ |
| G3 | **Helper logins** | Real logins for a lister or shipper with limited access (can list and ship; can't see payouts). Seats are already billed, but the helper logins themselves don't exist yet. | L | RLS changes | ★★★ |
| G4 | **Referrals** | "Give a month, get a month" through Stripe coupons; fits reseller communities. | S–M | G2 | ★★ |
| G5 | **Custom domain and email sending domain** | More trust, stable eBay and Supabase redirect addresses, and digest emails that don't land in spam. | S | ~$12/yr | ★★★ |
| G6 | **Help & feedback button + admin view** | An in-app problem-report form, plus a read-only operator page (users, plan, AI usage, eBay connection health). | M | none | ★★ |
| G7 | **Privacy-friendly product analytics** | Time to list, publish success rate, and where people drop off. | S | none | ★★ |

---

## 3. Impact vs effort, at a glance

| | Small effort | Medium effort | Large effort |
|---|---|---|---|
| **Very high impact** | A3 sync on, A1 all photos, F1 Supabase Pro | **B1 automatic watcher offers, B2 price-drop ladder, D1 haul cost, D2 profit, C1 bins + pick list** | — |
| **High impact** | B7 title score, D3 aging board, C2 label link, A10 stronger model on hard items | B3 markdown sales, B4 promoted listings, B5 views, B6 own-sold pricing, A2 offline, A4 learn my fixes, C3 AI replies, D5 tax export | — |
| **Medium** | F3–F6, B10, D4 | A5, A6, C4, F8, F9, G1 | A9 refactor, G3 helpers, E Depop API |

---

## 4. Top 5 to build next

1. **Haul cost + profit per item (D1 + D2, with migration 025).** Every "is this worth it" question depends on cost, and today no item has one. It also unlocks D3–D6 and keeps markdowns from going below cost.
2. **Automatic offers to watchers (B1).** Most of the pieces already exist (Negotiation API, floors). Making it a daily automatic job is the fastest way to more sales with no extra taps.
3. **Price-drop ladder for stale items (B2, then B3 eBay sales).** Old stock turns into cash on a schedule, protected by the floor and the cost.
4. **Bin location + pick list (C1).** It's cheap, and it saves minutes on every order once inventory is too big to keep in your head.
5. **Accuracy at the source: all photos + learn my fixes + stronger model on hard items (A1 + A4 + A10).** Review is still the biggest time cost, and the only way to shrink it is for the AI to get fewer fields wrong.

Also two 5-minute settings that need no code: **turn on the 10-minute sync (A3)** and **eBay's automatic feedback (C5)**.

---

## 5. Phased plan

### Phase 1: next push (about 1–1.5 weeks of build time)
- Settings only, no code: A3 (sync on), C5 (automatic feedback in Seller Hub), F6 (rate limiting on).
- F4: apply migration 025 and the foreign-key indexes. F3: fix photo cleanup.
- **D1 + D2:** haul cost and profit per item and per haul.
- **B1:** automatic offers to watchers (daily, with an on/off switch and a log).
- **C1:** bin location, pick list sorted by bin, packing slip.
- **A1:** analyze every photo. **B7:** title score.
- Add the `sell.marketing`, `sell.analytics.readonly` and `sell.fulfillment` permissions (one "Reconnect eBay" tap) so Phase 2 is ready.
- Decide on **F1 Supabase Pro**. Recommended now: backups matter even with one seller.

### Phase 2: sell more, think less (2–3 weeks)
- **B2** price-drop ladder → **B3** eBay markdown sales → **B4** promoted listings with a cap.
- **B5** views and impressions, with "price problem vs title problem" flags.
- **B6** prices from your own sold history.
- **D3** aging board, **D4** sell-through, **D5** tax export, **D6** weekly email.
- **A4** learn my fixes, **A10** stronger model on hard items, **C3** AI reply drafts.
- **C2** label link and tracking upload. **C4** instant sale alerts (needs Sel's OK to change eBay notification settings).
- **F2** Vercel Pro (move the 10-minute sync to a Vercel cron). **F5** uptime checks and alerts.

### Phase 3: scale and open the doors (4+ weeks)
- **A2** offline capture, **A5** shot checklist, **A6** voice notes, **A7** parallel grouping, **A8** push notifications, **A9** batch-screen refactor.
- **E** cross-listing helpers (copy-ready Poshmark/Mercari, Mercari import, Depop partner application), plus the required delist alerts.
- **F7** eBay Growth Check, **F8** staging, **F9** end-to-end tests, **F10** plan for older eBay calls.
- **G1** onboarding, **G2** live billing, **G3** helper logins, **G4** referrals, **G5** domain, **G6** support and admin, **G7** analytics.
- **C6** returns view, **B8** better main photo.

---

## 6. Monthly running costs if all of this is adopted (estimates)

| Item | Monthly |
|---|---|
| Supabase Pro | $25 |
| Vercel Pro | $20 |
| OpenAI at 50 items/day (~1–3¢ each, including the stronger model on hard items, replies and voice notes) | ~$15–45 |
| Promoted listings | A % of sales that come through ads only (Sel's choice) |
| Domain | ~$1 |
| Upstash, Sentry, uptime checks | $0 (free tiers) |
| **Total, not counting ad fees** | **~$60–90/mo** |

---

## Sources (checked Nov 26, 2026)

- eBay Negotiation API (offers to interested buyers): https://developer.ebay.com/api-docs/sell/negotiation/static/overview.html
- eBay Marketing API, markdown sales: https://developer.ebay.com/api-docs/sell/marketing/resources/item_price_markdown/methods/createItemPriceMarkdownPromotion
- eBay Promoted Listings API: https://developer.ebay.com/api-docs/sell/static/marketing/pl-overview.html
- eBay Analytics API, traffic report: https://developer.ebay.com/api-docs/sell/analytics/resources/traffic_report/methods/getTrafficReport
- eBay Logistics API (limited release): https://developer.ebay.com/api-docs/sell/logistics/overview.html
- eBay notifications: https://developer.ebay.com/develop/guides-v2/communications/sell-communications-guide
- eBay Magical Listing and bulk AI tool: https://innovation.ebayinc.com/stories/magical-bulk-listing-tool-is-ebays-latest-ai-powered-time-saver-for-sellers/ and https://www.digitalcommerce360.com/2026/11/11/ebay-visual-identification-magical-listing-tool/
- Competitor comparisons (written by vendors, so biased): https://crosslist.com/blog/vendoo-pricing, https://blog.vendoo.co/primelister-vs-list-perfectly, https://crosslist.com/blog/flyp-alternatives
- Mercari cross-listing import: https://mercari.com/us/help_center/article/609
- Crosslisting API landscape (vendor claim): https://flowlister.com/how-crosslisting-works/
- Supabase advisors and Vercel runtime errors: read from the live projects (read-only).
