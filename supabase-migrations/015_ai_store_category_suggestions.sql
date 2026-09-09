-- Settings -> "Store category suggestions" -> AI suggestions toggle.
-- Off by default: the free keyword-based suggestion (client-side, see
-- src/lib/store-category-match.ts) is what every seller gets automatically
-- with no setup. This column opts an account into an extra per-item AI
-- call (src/app/api/ebay/store-categories/suggest/route.ts) that picks
-- from the seller's real Store Category list more accurately than keyword
-- matching alone can for oddly-named categories -- at the cost of counting
-- against that account's monthly AI usage cap.
alter table public.app_settings add column if not exists ai_store_category_suggestions boolean not null default false;
