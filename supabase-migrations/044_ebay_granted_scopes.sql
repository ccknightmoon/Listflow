-- 044 (NOT APPLIED -- needs Sel's approval). Which eBay permissions each
-- seller granted, so new permissions (sell.marketing, sell.analytics.readonly,
-- sell.fulfillment) can be added with one "Reconnect eBay" tap WITHOUT
-- breaking connections made before.
--
-- null = connected before this column existed = the original 5 scopes.
-- Token refresh asks only for what was granted (asking for more makes eBay
-- refuse the refresh, which would disconnect everything).
--
-- Rollback: alter table public.ebay_connections drop column if exists granted_scopes;

alter table public.ebay_connections add column if not exists granted_scopes text;
