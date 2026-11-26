-- 040 (NOT APPLIED -- needs Sel's approval). Replaces 025's sale_costs part.
--
-- Checked live (read-only, Nov 26, 2026): drafts_user_listing_idx from 025
-- EXISTS, but public.sale_costs does NOT, so 025 only half-ran (its
-- `create policy` lines aren't re-runnable, which is the likely reason a
-- retry failed). This file is safe to run any number of times: every
-- statement is "if not exists" or drops the policy first.
--
-- Unlocks: "Add costs" on the Sales page for sales that weren't listed
-- through Listflow, and the cost column in the tax export.
--
-- Rollback:  drop table if exists public.sale_costs;

create table if not exists public.sale_costs (
  user_id uuid not null references auth.users(id) on delete cascade,
  sale_key text not null,          -- "<ebay item id>-<transaction id>"
  ebay_listing_id text not null,
  cost numeric(10, 2) not null check (cost >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, sale_key)
);

alter table public.sale_costs enable row level security;

drop policy if exists "sale_costs_select_own" on public.sale_costs;
drop policy if exists "sale_costs_insert_own" on public.sale_costs;
drop policy if exists "sale_costs_update_own" on public.sale_costs;
drop policy if exists "sale_costs_delete_own" on public.sale_costs;
create policy "sale_costs_select_own" on public.sale_costs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "sale_costs_insert_own" on public.sale_costs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "sale_costs_update_own" on public.sale_costs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "sale_costs_delete_own" on public.sale_costs
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.sale_costs from anon;
grant select, insert, update, delete on public.sale_costs to authenticated;

create index if not exists drafts_user_listing_idx
  on public.drafts (user_id, ebay_listing_id)
  where ebay_listing_id is not null;
