# Listflow fix plan (Nov 15, 2026)

Goal: get Listflow back to a working batch-listing flow, safely, without touching production.
All work happens on branch `fix/publish-and-hardening`, deployed to a Vercel **preview** only.

| # | Task | Approach | How it's verified |
|---|---|---|---|
| 1 | Clean slate | Throw away the half-done uncommitted edits (they break the build). Keep the new `stale-listings.test.ts`. | `tsc` + `next build` pass on the clean branch |
| 2 | Next.js 16 "proxy" rename | Redo it properly: `src/middleware.ts` -> `src/proxy.ts`, export `proxy()`, update related comments. | Build lists `Proxy (Middleware)`, no deprecation warning |
| 3 | Security updates | `next` + `eslint-config-next` -> 16.4.6, `@sentry/nextjs` latest 10.x, safe patch bumps, `npm audit fix` (no `--force`). | `npm audit --omit=dev`: no critical/high in production deps |
| 4 | eBay "Invalid ShippingPackage" publish failure | Pull the real error from Vercel logs / Supabase; check eBay Inventory API rules for `packageWeightAndSize`; fix how package type/weight/size is built for light items (clothing). No live eBay listings created to test. | New unit tests for the package builder; existing tests still pass |
| 5 | SKU collisions in batch "List all" | When two items race for the same SKU, retry with the next free SKU instead of failing. | New unit tests for the retry logic |
| 6 | Supabase advisor warnings | Prepare (not apply) a migration for `set_updated_at` search_path. `login_attempts` has no policies by design (service-role only). | Reported for approval |
| 7 | Final verification | Fresh `npm ci`, `tsc --noEmit`, `eslint`, `vitest run`, `next build`; then preview deploy. | All pass; preview URL loads |

Out of scope for now: Stripe, shipping labels, email digest scheduler, rate limiting setup, removing old Vercel env vars.
