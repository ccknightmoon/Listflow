-- Seller-entered override for the eBay final value fee percentage used in
-- the Sales page's estimated fee / net-profit calculation. NULL means the
-- app falls back to its standard-rate default (EBAY_STANDARD_FEE_PERCENT in
-- src/lib/ebay-fees.ts). This is always an ESTIMATE: the app has no access
-- to eBay's real per-order fee data, which would require the sell.finances
-- OAuth scope that this app's Trading-API-based integration doesn't request.
alter table public.app_settings
  add column if not exists ebay_fee_percent_override numeric(5, 2);

comment on column public.app_settings.ebay_fee_percent_override is
  'Seller override for the estimated eBay final value fee percent shown on the Sales page. NULL = use the app''s standard-rate default. Always an estimate, never eBay''s real per-order fee data.';
