# Launch readiness — opening Listflow to other sellers

**Status today (Nov 18, 2026):** personal use by Sel only. This is the checklist of everything that must be true before other sellers can sign up. Keep it current: when an item changes, update its status and date here.

**Design rule until then:** every feature stays per-user (rows keyed by `user_id`, RLS-scoped, per-user eBay context). No single-user shortcuts, even while there is only one user.

**Columns.** Effort: S ≈ under half a day, M ≈ 1–2 days, L ≈ 3+ days. Status: ✅ done · 🟡 partial · ⬜ todo.

## P0 — must be done before the first outside seller

| # | Item | Why | Effort | Status |
|---|---|---|---|---|
| 1 | **Supabase Pro plan, daily backups + point-in-time recovery** | The free tier auto-pauses after inactivity (it already paused once) and has no backups. One bad migration or a deleted row would be unrecoverable for every seller. | S ($25/mo) | ⬜ |
| 2 | **Per-seller SKU uniqueness** | The index `drafts_custom_sku_unique` is unique across the whole table, so seller B can't use SKU "1" once Sel has it. Drop it and keep the per-user `(user_id, custom_sku)` unique index that already exists. Needs a migration. | S | ⬜ |
| 3 | **Every table RLS-scoped to the owner; every job loops over all sellers** | Prevents one seller seeing another's data, and makes background work run for everyone, not just Sel. *Checked Nov 18:* all 7 public tables have RLS with `auth.uid() = user_id`. `login_attempts` has RLS and no policies on purpose (service role only). Migrations 025/026 follow the same pattern. Crons `purge-deleted-accounts`, `daily-digest` and `snapshot-listings` all iterate every row of their source table. Re-check whenever a table or job is added. | S | ✅ (re-check per change) |
| 4 | **eBay production keyset limits** | Trading/REST APIs have daily call limits per app. Thousands of listings plus analytics for many sellers will exceed the defaults. Request an increase via eBay's **Application Growth Check** (formerly Compatible Application Check) once usage data exists. | M (mostly eBay's review time) | ⬜ |
| 5 | **eBay Marketplace Account Deletion notifications** | Required by eBay for any app storing eBay user data. Without it eBay can disable the keyset. Needs an HTTPS endpoint that answers eBay's challenge and deletes or anonymizes that eBay user's data, registered in the developer portal. | M | ⬜ |
| 6 | **Supabase auth hardening + password reset** | Password reset links currently fail because the redirect URL isn't allow-listed. Also needed: leaked-password protection (Pro), email confirmation on signup, and a login lockout (exists via `/api/auth/lockout`). | S | 🟡 lockout done; redirect URL and leaked-password protection todo |
| 7 | **Stripe billing and tiers** ($29 Pro / $59 Power Seller) | Revenue, plus limits that protect costs. Needs Checkout, Customer Portal, webhooks → `subscriptions` table (RLS), plan gates on AI usage / batch size / analytics, and failed-payment handling. The membership page is UI only today. | L | ⬜ |
| 8 | **Legal: Terms, Privacy, eBay API License** | Required by eBay and app stores, and it limits liability. The privacy page has been rewritten to match eBay's requirements; a terms page exists. Before launch they need a lawyer review, Stripe and AI-processing disclosures, and a data-retention section. | M | 🟡 |
| 9 | **Secrets audit** | The service-role key, the eBay token encryption key and `CRON_SECRET` must exist only in Vercel (sensitive) and never reach the browser or the repo. *Checked:* the service role is used only in `supabase-service.ts`, `ai-usage.ts`, the lockout route and crons; `.env*` files are git-ignored. Rotate keys at launch, and remove the deprecated env vars (`EBAY_OAUTH_REFRESH_TOKEN`, `EBAY_SHIPPING_*`, `EBAY_RETURN_POLICY_ID`, `EBAY_USER_TOKEN`). | S | 🟡 |
| 10 | **Per-user OpenAI cost controls** | One seller's batch could run up the AI bill. A per-user daily AI cap exists (`check_and_consume_ai_usage`, migration 010). It needs per-plan quotas tied to Stripe tiers, a monthly spend alert and a usage view for the seller. | M | 🟡 |
| 11 | **Rate limiting and abuse protection** | Stops brute-force logins and runaway API use. Upstash rate limiting is coded in `proxy.ts` but is **silently skipped** because `UPSTASH_REDIS_*` isn't set in Vercel. Set it up; add bot protection on signup (Turnstile/hCaptcha). | S | 🟡 |
| 12 | **Staging environment** | Testing migrations and eBay changes on production data is risky with several users. Needs a second Supabase project, a Vercel preview env with sandbox or test eBay keys, and seed data. | M | ⬜ |

## P1 — needed within the first weeks

| # | Item | Why | Effort | Status |
|---|---|---|---|---|
| 13 | **Error monitoring and alerting** | Know about failures before sellers do. Sentry is wired up (client/server/edge). Still needed: alert rules (new issue, error spike), release tagging, PII scrubbing check. | S | 🟡 |
| 14 | **Uptime monitoring** | A paused database or a failed deploy shouldn't be found by users. External checks on `/`, `/login` and a health route that pings Supabase; status alerts by email/SMS. | S | ⬜ |
| 15 | **Onboarding + empty-state demo** | New sellers land on empty screens. Needs a guided first run (connect eBay → pick a calculated-shipping policy → first listing), sample data or a demo mode, and empty states on every page. | M | ⬜ |
| 16 | **Support and feedback channel** | Sellers need a way to report problems. An in-app "Help & feedback" form (email or ticket), a status page link and an FAQ. | S | ⬜ |
| 17 | **Admin dashboard** | Support, abuse handling and billing issues need an operator view. Internal-only page (admin role): users, plan, AI usage, eBay connection health, last errors, impersonation-free read-only view. | M | ⬜ |
| 18 | **Account deletion and data export** | Privacy law and trust. Deletion has a 30-day grace period plus a purge cron (photos, rows). Still needed: data export (drafts, sales CSV, costs) and deletion of `sale_costs` / `active_listing_snapshots` rows (covered by `on delete cascade`). | S | 🟡 |
| 19 | **Dependency and security scanning in CI** | Catch vulnerable packages and leaked secrets on every push. CI runs lint/typecheck/tests. Add `npm audit --omit=dev`, Dependabot or Renovate, secret scanning, and CodeQL. | S | 🟡 |
| 20 | **Email deliverability** | Resets, digests and billing mail must arrive. Resend is in use. Needs an SPF/DKIM/DMARC custom sending domain, bounce handling and an unsubscribe link on digests. | S | 🟡 |
| 21 | **Custom domain** | Trust and stable OAuth redirect URLs (eBay RuName, Supabase). Currently `listflow-two.vercel.app`. Buy a domain, then update the eBay RuName, Supabase redirect URLs and Resend domain. | S | ⬜ |
| 22 | **Storage privacy** | The `photos` bucket is public (eBay must fetch images), with per-user folder policies on write/delete. Listing photos being public is acceptable, but drafts' photos are guessable-URL public too. Consider signed URLs for unpublished drafts. | M | 🟡 |
| 23 | **Background jobs at scale** | Batch publishing runs in the browser today (PLAN-ux 1.3 moves it server-side). Crons run on Vercel Hobby (daily only, 60 s limit). Multi-seller needs Vercel Pro or a queue (e.g. Upstash QStash) with per-seller fairness. | M | 🟡 |

## P2 — before growth / marketing

| # | Item | Why | Effort | Status |
|---|---|---|---|---|
| 24 | **Load testing** | Know the limits (eBay calls/min, Supabase connections, function time) before a marketing push. Script 20–50 simulated sellers against staging with eBay calls stubbed. | M | ⬜ |
| 25 | **Product analytics** | Learn what sellers use and where they drop off. Privacy-friendly events (PostHog/Plausible): listings created, publish success rate, time-to-list. | S | ⬜ |
| 26 | **Data migration for Sel's account** | Sel's existing data (drafts, costs, snapshots) must survive moves to Pro, staging or a new domain. Documented backup → restore runbook, tested once. | S | ⬜ |
| 27 | **Accessibility (WCAG AA)** | Broader audience; app-store and legal expectations. See PLAN-ux 3.4. | S | ⬜ |
| 28 | **Pending migrations applied** | 024 (function search_path), 025 (sale_costs), 026 (snapshots, listing start) — each written with rollback, awaiting approval. | S | 🟡 |
