-- 041 (NOT APPLIED -- needs Sel's approval). Hauls (sourcing trips) + bin locations.
--
-- * hauls: one row per sourcing trip ("Rag house X, Nov 26, $120").
-- * drafts.haul_id: which haul an item came from (null = none).
-- * drafts.bin_location: shelf/bin label like "B3" for the pick list.
-- Additive only. The app works without this file (the Hauls page says
-- "database update pending"; bins aren't shown).
--
-- Rollback:
--   alter table public.drafts drop column if exists bin_location;
--   alter table public.drafts drop column if exists haul_id;
--   drop table if exists public.hauls;

create table if not exists public.hauls (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  source      text check (source is null or char_length(source) <= 120),
  bought_on   date not null default current_date,
  total_cost  numeric(10, 2) not null default 0 check (total_cost >= 0 and total_cost <= 100000),
  weight_lb   numeric(8, 2) check (weight_lb is null or weight_lb >= 0),
  notes       text check (notes is null or char_length(notes) <= 2000),
  split_mode  text not null default 'even' check (split_mode in ('even', 'price')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists hauls_user_bought_idx on public.hauls (user_id, bought_on desc);

alter table public.hauls enable row level security;
drop policy if exists "hauls_select_own" on public.hauls;
drop policy if exists "hauls_insert_own" on public.hauls;
drop policy if exists "hauls_update_own" on public.hauls;
drop policy if exists "hauls_delete_own" on public.hauls;
create policy "hauls_select_own" on public.hauls
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "hauls_insert_own" on public.hauls
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "hauls_update_own" on public.hauls
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "hauls_delete_own" on public.hauls
  for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.hauls from anon;
grant select, insert, update, delete on public.hauls to authenticated;

alter table public.drafts add column if not exists haul_id uuid references public.hauls(id) on delete set null;
alter table public.drafts add column if not exists bin_location text
  check (bin_location is null or char_length(bin_location) <= 24);
create index if not exists drafts_haul_idx on public.drafts (haul_id) where haul_id is not null;
