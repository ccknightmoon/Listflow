-- NOT YET APPLIED -- needs Sel's approval before running.
--
-- Sales analytics (Nov 17, 2026). Additive only: one new table + one index.
-- The Sales page works without this migration; until it's applied:
--   * costs can only be added for sales listed through Listflow (they're
--     saved on the draft), and the page says so for the others;
--   * the drafts lookup by eBay listing ID runs without an index (fine at
--     today's size, slower as drafts grow).
--
-- 1. sale_costs: item cost for sales that have no Listflow draft (listed
--    directly on eBay or before Listflow). One row per sale line.
-- 2. drafts (user_id, ebay_listing_id) index for the sales join.
--
-- Rollback:  drop table if exists public.sale_costs;
--            drop index if exists public.drafts_user_listing_idx;

begin;

create table if not exists public.sale_costs (
  user_id uuid not null references auth.users(id) on delete cascade,
  sale_key text not null,          -- "<ebay item id>-<transaction id>"
  ebay_listing_id text not null,
  cost numeric(10, 2) not null check (cost >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, sale_key)
);

alter table public.sale_costs enable row level security;

create policy "sale_costs_select_own" on public.sale_costs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "sale_costs_insert_own" on public.sale_costs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "sale_costs_update_own" on public.sale_costs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "sale_costs_delete_own" on public.sale_costs
  for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists drafts_user_listing_idx
  on public.drafts (user_id, ebay_listing_id)
  where ebay_listing_id is not null;

commit;
