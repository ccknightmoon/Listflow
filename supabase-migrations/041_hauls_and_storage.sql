-- 041 (NOT APPLIED -- needs Sel's approval). Hauls (sourcing trips) +
-- storage locations for the pick list.
--
-- * hauls: one row per sourcing trip ("Rag house X, Nov 26, $120").
-- * drafts.haul_id: which haul an item came from (null = none; plain uuid, no FK).
-- * drafts.bin_location: free-text storage location ("RACK B", "BIN 3"),
--   used only when the seller picks "Bins / racks" in Settings.
-- * app_settings.storage_settings: Settings → "Storage & pick list"
--   ({enabled, mode: sku_boxes | bins | sku_only, boxes: [{name, from, to}]}).
--   NULL = OFF (the default): no location anywhere, To-ship sorts by SKU.
-- Additive only. The app works without this file (the Hauls page says
-- "database update pending"; storage stays off).
--
-- Rollback:
--   alter table public.app_settings drop column if exists storage_settings;
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

-- No foreign key on purpose: a draft restored from the recycle bin (037)
-- must never fail because its haul was deleted meanwhile. Deleting a haul
-- clears the link in the app (DELETE /api/hauls/[id]); a stale id just
-- matches no haul.
alter table public.drafts add column if not exists haul_id uuid;
alter table public.drafts add column if not exists bin_location text
  check (bin_location is null or char_length(bin_location) <= 24);
create index if not exists drafts_haul_idx on public.drafts (haul_id) where haul_id is not null;

alter table public.app_settings add column if not exists storage_settings jsonb;
