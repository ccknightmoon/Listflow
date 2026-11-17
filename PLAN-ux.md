# Listflow — whole-app UX & speed plan (Nov 18, 2026)

**Status: plan only — waiting for Sel's go-ahead.** Nothing here is built yet.

**Goal:** post more listings, faster, from a phone, in an app that looks and feels as polished everywhere as the Sales page.

**How the app was reviewed:** every screen's code (dashboard, new listing, batch upload, drafts, draft editor, store/listings, sales, offers, messages, ship, settings, login / forgot / reset password, membership), plus the shared nav, toast and global styles. Numbers below (line counts, spinner counts, etc.) come from that pass.

**Legend.** Effort: S ≈ under half a day, M ≈ 1–2 days, L ≈ 3+ days. Risk: Low / Med / High (chance of breaking something that works today).

---

## Phase 1: Faster listing, plus a consistent look (biggest wins, low risk)

| # | Item | What changes and why it matters for Sel | Effort | Risk | How it's verified |
|---|---|---|---|---|---|
| 1.1 | **"+" list button in the bottom nav** | The nav has Home / Listings / Sales / Settings only; starting a listing takes 2+ taps from anywhere. Add a raised centre "+" that opens a sheet with *Snap one item* and *Batch upload*, and a long-press that goes straight to the camera. | S | Low | Tap-count check: home → camera = 1 tap (today 2–3). Nav render test. |
| 1.2 | **Photo-to-live fast path** | New Listing today: photos → Analyze → wait for pricing → review modal → Publish. Add **"Analyze & list"**: after the AI fills the fields, if the readiness checks pass (photos, title ≤ 80, price, condition, calculated policy) show one confirm screen and publish in the background while the camera reopens for the next item. A draft is always saved first, so nothing is lost. | M | Med | Unit tests on the readiness gate. Manual run: 10 items timed before and after (target: about 30% fewer taps per item). |
| 1.3 | **Background publishing with a progress tray** | Batch "List all" runs inside the page (2 at a time); leaving the page pauses it, and there's a "don't leave" warning. Move publishing onto the existing `batch_jobs` table, worked on by a server route that keeps going after the response. Add a small tray above the nav ("Listing 7 of 20…") on every page, with tap-to-retry on failures. | L | Med | Tests on job state changes. Manual: start 20, navigate away, all finish. Retry/idempotency covered by the existing duplicate-publish guard. |
| 1.4 | **Shared design system** | Pull the Sales page's look into reusable pieces: `PageHeader` (title, subtitle, actions, with the background-glow layering fix built in), `StatTile`, `SectionCard`, `InfoTip`, `Skeleton`, `EmptyState`, `Sheet`. Add type-scale tokens (display / title / body / caption), using `formatMoney` everywhere. | M | Low | Render tests per component. Visual check on every page at 390 px width. |
| 1.5 | **Fix the blurred-header bug app-wide** | Same cause as on Sales: the background glow paints over any header that isn't positioned. Fixed once in `PageHeader` (1.4) so every page benefits. | S | Low | Screenshot each page on iOS Safari. |
| 1.6 | **Skeletons instead of spinners** | 80 spinner uses across pages (settings 13, batch 13, drafts editor 11); only Sales has skeletons. Use content-shaped skeletons and keep showing cached data while refreshing. | M | Low | Each page loads with no layout jump; render tests. |
| 1.7 | **Replace browser `confirm()` pop-ups** | 10 native `confirm()` calls (delete, delist, relist, offers…) look out of place on a phone. Use a styled bottom-sheet confirm with a clear destructive button and **Undo** where possible (delete draft, delist). | S | Low | Component test, then manually check each flow. |
| 1.8 | **Add to Home Screen** | No web app manifest or icons, so the home-screen app opens like a browser tab. Add a manifest, icons, standalone mode, safe-area padding and a theme colour. | S | Low | Install on iPhone: it opens full-screen with the right icon and the status bar isn't overlapped. |

## Phase 2: High-volume editing and day-to-day workflow

| # | Item | What changes and why it matters | Effort | Risk | How it's verified |
|---|---|---|---|---|---|
| 2.1 | **Bulk edit in Drafts and Listings** | Drafts can list, duplicate or delete in bulk; Listings can bulk-price. Add bulk edit of condition, category, price (± $ / %), shipping package, and add/remove words in titles, with a preview before applying. | M | Med | Unit tests on the edit maths. Preview equals the result. Undo snapshot. |
| 2.2 | **Swipe actions and quick price changes** | Swipe a draft → List / Duplicate / Delete; swipe a listing → −10% / Relist / End. One-handed use while sourcing. | M | Low | Manual on iOS/Android; accessible button fallbacks. |
| 2.3 | **Faster camera loop** | Multi-shot capture with a "next item" divider; the first photo becomes the cover automatically; lighter re-compression; upload starts while the next photo is being taken. | M | Med | Timing check: 5 photos ready to analyze, before vs after. |
| 2.4 | **Keyboard and form ergonomics** | Number pad for prices; Enter moves to the next field; sticky Save/List bar above the keyboard; remember the last condition/category per session. | S | Low | Manual on iOS/Android. |
| 2.5 | **"Needs attention" inbox on the dashboard** | One list combining orders to ship, offers, buyer questions, failed publishes, and drafts missing a photo or price, each with a one-tap action. Replaces scattered tiles. | M | Low | Count matches each source page; render test. |
| 2.6 | **Offers, messages and shipping polish** | Counter-offer presets (e.g. −5% / −10% / floor price), templated replies, and printing pick lists for ship-today orders. | M | Low | Unit tests on the offer maths; manual flows. |
| 2.7 | **Sales follow-ups** | Make sure eBay's own totals check works (the live badge said "From eBay Finances", meaning eBay's summary wasn't used — confirm the response format against a real call). Sell-through trend once daily counts build up (migration 026). | S | Low | The badge shows "✓ Matches eBay" on live data. |

## Phase 3: Foundations, cleanup and growth

| # | Item | What changes and why it matters | Effort | Risk | How it's verified |
|---|---|---|---|---|---|
| 3.1 | **Split the 3,031-line Batch Upload page** | Into steps (capture → group → review → publish) with shared state. Reduces bugs and makes items 1.2 and 1.3 easier to build. | L | Med | Existing tests plus new step tests; a full batch run manually. |
| 3.2 | **Per-seller SKU uniqueness** | The database's `drafts_custom_sku_unique` index is global: fine for one seller, but blocks a second seller from using "1", "2"… Change it to per seller (needs a migration). | S | Med | Migration on a branch database; SKU tests. |
| 3.3 | **Pending database updates and settings** | Apply 024, 025 and 026 (after approval). Supabase redirect URL for password reset. Leaked-password protection. An outside scheduler for the hourly email digest. | S | Low | Supabase security checker clean; reset-password email works end to end. |
| 3.4 | **Accessibility pass** | Contrast on tertiary text, focus rings, 44 px tap targets, labels on icon buttons. | S | Low | WCAG AA check on the main screens. |
| 3.5 | **Stripe billing** | Only after phases 1–2, per the agreed order. | L | Med | Stripe test mode end to end. |

## Execution approach

- **One branch per item group, small commits.** Every change passes typecheck, lint, all tests and a production build, and goes out as a Vercel preview before production.
- **Each phase is demoed** on Sel's phone (screenshots plus a tap-count/timing table) before the next one starts.
- **No live eBay posting while building.** Publishing logic is unit-tested; real listings happen only when Sel chooses.
- **Database changes ship as reviewable migration files** with a rollback, and are applied only after Sel's approval.
