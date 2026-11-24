-- 032 (NOT APPLIED -- needs Sel's approval). eBay Marketplace Account
-- Deletion notifications identify the eBay user by username, immutable
-- user ID and EIAS token. For US users eBay may send an immutable ID in
-- place of the username, so matching on the EIAS token (from Trading
-- GetUser, saved at connect time and backfilled by the daily snapshot cron)
-- is the reliable path. Without this migration the endpoint still works,
-- matching on ebay_user_id (username) only.
--
-- Additive only: one nullable column and two lookup indexes. RLS on
-- ebay_connections is unchanged (owner-only).
alter table public.ebay_connections add column if not exists ebay_eias_token text;
create index if not exists ebay_connections_ebay_user_id_idx on public.ebay_connections (ebay_user_id);
create index if not exists ebay_connections_ebay_eias_token_idx on public.ebay_connections (ebay_eias_token);

-- Rollback:
--   drop index if exists public.ebay_connections_ebay_eias_token_idx;
--   drop index if exists public.ebay_connections_ebay_user_id_idx;
--   alter table public.ebay_connections drop column if exists ebay_eias_token;
