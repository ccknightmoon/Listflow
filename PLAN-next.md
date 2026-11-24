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
