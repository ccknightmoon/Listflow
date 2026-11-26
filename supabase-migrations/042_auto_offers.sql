-- 042 (NOT APPLIED -- needs Sel's approval). Automatic offers to watchers.
--
-- Everything defaults to OFF. Nothing is ever sent unless ALL of these are
-- true: Vercel env AUTO_OFFERS_ENABLED=1, Settings -> "Automatic offers"
-- switched on, and the item opted in (or "all live items" chosen).
-- Offers never go below the item's Best Offer floor or its cost.
--
-- Rollback:
--   drop table if exists public.auto_offer_log;
--   alter table public.drafts drop column if exists auto_offer_opt_in;
--   alter table public.app_settings drop column if exists auto_offers_enabled,
--     drop column if exists auto_offers_percent, drop column if exists auto_offers_min_days,
--     drop column if exists auto_offers_all_items, drop column if exists auto_offers_repeat_days;

alter table public.app_settings add column if not exists auto_offers_enabled boolean not null default false;
alter table public.app_settings add column if not exists auto_offers_percent integer not null default 10
  check (auto_offers_percent between 5 and 50);
alter table public.app_settings add column if not exists auto_offers_min_days integer not null default 3
  check (auto_offers_min_days between 0 and 365);
alter table public.app_settings add column if not exists auto_offers_all_items boolean not null default false;
alter table public.app_settings add column if not exists auto_offers_repeat_days integer not null default 7
  check (auto_offers_repeat_days between 2 and 90);

alter table public.drafts add column if not exists auto_offer_opt_in boolean not null default false;

create table if not exists public.auto_offer_log (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  ebay_listing_id  text not null,
  draft_id         uuid,
  discount_percent integer not null,
  list_price       numeric(10, 2),
  offer_price      numeric(10, 2),
  floor_price      numeric(10, 2),
  status           text not null check (status in ('sent', 'skipped', 'failed', 'preview')),
  detail           text,
  created_at       timestamptz not null default now()
);
create index if not exists auto_offer_log_user_listing_idx on public.auto_offer_log (user_id, ebay_listing_id, created_at desc);

alter table public.auto_offer_log enable row level security;
drop policy if exists "auto_offer_log_select_own" on public.auto_offer_log;
create policy "auto_offer_log_select_own" on public.auto_offer_log
  for select to authenticated using ((select auth.uid()) = user_id);
-- Writes only from the server (service role); sellers can read their log.
revoke all on public.auto_offer_log from anon;
revoke insert, update, delete on public.auto_offer_log from authenticated;
grant select on public.auto_offer_log to authenticated;
