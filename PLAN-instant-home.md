# Instant Home (branch `feat/instant-home`, Nov 24, 2026)

## 1. Diagnosis (measured on production 88577ef, Sel's Chrome, desktop)

Where the time goes, in order:

| Step | Measured | Why |
|---|---|---|
| Home HTML | 0.8 s warm, **2.1 s cold** (first open after an idle hour) | Every page request first runs the auth check in `proxy.ts`: a call to Supabase Auth (`getUser`) **plus** an `app_settings` read (pending-deletion check), both from Vercel's **iad1 (Washington DC)** to Supabase **us-west-2 (Oregon)**: ~70 ms each way, several trips. Cold = function start + new connections. |
| Each signed-in API call | **0.75–1.45 s** warm (settings 0.74–1.0 s, ai-usage 0.96–1.25 s, drafts counts 0.6–1.1 s, dashboard summary 0.95–1.45 s; a static file is 0.2 s) | Same proxy auth (2 trips) + `requireUser()` (another Auth call) + the query itself, all cross-country. The summary also calls eBay, but it's cached server-side. |
| Home JS | 9 files, 234 KB compressed / 788 KB unpacked; the Home page's own part is 96 KB, of which **67 KB is the Supabase browser client**, loaded only to show your name | |
| Request order on open | ai-usage + jobs sweep start first (~1–1.4 s), then the jobs list (after the sweep, +1 s); the summary + 2 draft counts (~1.5–2.2 s) | The jobs/AI calls compete with what Home actually needs. |
| Fonts | 2 files, self-hosted, ~67 KB, fast | Not a problem. |

Vercel's own function timings/cold-start metrics aren't available on the Hobby plan (no Observability; runtime logs keep 1 hour and had no traffic), so the numbers above are from the browser.

**Region:** functions in **iad1**, database in **us-west-2**. They are far apart (~70 ms per trip), and a signed-in request makes 3–5 trips in a row. This is the biggest single cost.

Note: in a background tab Chrome delays React's reveal of the page until the tab is shown (Home sat on "Loading…" until it was visible). Not an issue on the iPhone, where the app is in front.

## 2. Fixes

- **Instant Home from the device's last copy.** Home saves its numbers, name, chart and Needs-attention counts on the device (localStorage, wrapped in try/catch) and paints them before the first frame, then refreshes in the background with a small "· updating…" next to the greeting. The copy records whose account it is; if the server says a different user is signed in, it's wiped at once. All saved copies are cleared on sign-out and on every sign-in.
- **App-shell service worker** (`/sw.js`, built from `src/lib/sw-source.ts`): hashed JS/CSS/fonts/icons come from the device (cache-first). The HTML of Home, Listings, Drafts and Sales is stale-while-revalidate: the saved page shows at once and a fresh one is fetched behind it. These pages contain no account data (numbers come from `/api` afterwards). `/api/*` is **never** cached by the worker. Each deploy is a new worker version that drops the previous deploy's saved pages. If the background fetch gets redirected (signed out / pending deletion), the saved page is deleted and the open page follows the redirect; any `/api` 401 still sends you to /login as before. Cleared on sign-out. Kill switch: set `NEXT_PUBLIC_DISABLE_SW=1` in Vercel and redeploy (it unregisters itself).
- **No Supabase Auth round trip per request.** `proxy.ts` and `requireUser()` now verify the session's JWT locally against the project's published ES256 key (`getClaims`; JWKS fetched once and cached) instead of calling Supabase Auth each time. Trade-off: a session revoked on the server stays valid until its access token expires (max 1 h). The pending-deletion check remembers "not pending" for 60 s per server instance ("pending" is never cached, so Reactivate works at once).
- **First-paint requests first.** The jobs sweep/pill waits 2.5 s after open (immediate on /batches), and the AI-usage banner check waits 3 s. Home's name now comes with the summary, so Home no longer needs the Supabase browser client.
- **Smaller Home bundle:** Home's own JavaScript went from **96 KB to 30 KB** compressed (the 67 KB Supabase client is gone from it). Listings 38 KB, Drafts 33 KB, Sales 41 KB. The charts are small inline SVG, so lazy-loading them wouldn't save anything meaningful.
- **Same instant pattern on Listings, Drafts (default view) and Sales:** last copy (up to 3 days old) shows at once while the live load runs.

## 3. Measurements

| | Before (measured on 88577ef) | After (expected; measure on the phone after deploy) |
|---|---|---|
| Warm open, numbers on screen | HTML 0.8 s + JS + summary ~1–2.2 s → **~2–3 s** | saved page + saved numbers: **~0.1–0.3 s**; live numbers replace them ~0.6–1 s later |
| Cold open | HTML 2.1 s + summary ~2 s → **~4–5 s** | same instant paint from the device; live numbers ~1.5–2.5 s later |
| Each signed-in API call | 0.75–1.45 s | ~0.3–0.4 s less (one Auth round trip and usually the settings read removed) |
| Home JS (own part) | 96 KB gz | 30 KB gz |

The "after" column couldn't be measured from here (the branch isn't deployed, and this sandbox can't reach Supabase). To read it after the push, open Home and check `window.__listflowHome` in the browser console: `saved` = ms until the device copy showed, `live` = ms until the fresh numbers showed.

## 4. Region (recommendation, not changed)

Functions run in **iad1 (Washington, DC)**; the database is in **us-west-2 (Oregon)**. Each request makes several trips between them in a row. Moving the functions next to the database removes most of that: Vercel → listflow → Settings → Functions → Function Region → **Portland, USA (pdx1)** → Save, then redeploy. (Hobby allows one region.) The single phone ↔ Vercel trip gets ~60 ms longer from the East Coast, but each database/auth trip drops from ~70 ms to a few ms, and there are 3–5 per request. Cold starts on Hobby can't be measured here (no Observability on Hobby) and can't be pre-warmed for free without a cron; the instant paint above hides them on open anyway.
