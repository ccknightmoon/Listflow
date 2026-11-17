-- NOT YET APPLIED -- needs Sel's approval before running.
--
-- Start capturing history eBay doesn't keep, so the Sales page can stop
-- approximating (Nov 18, 2026). Additive only.
--
-- 1. active_listing_snapshots: how many listings were active each day.
--    Written by the daily cron (/api/cron/snapshot-listings, scheduled in
--    vercel.json) and whenever the Sales page loads. Makes sell-through
--    for past periods (and its trend) exact instead of using today's count.
-- 2. drafts.ebay_listed_at: the moment Listflow published the listing, so
--    days-to-sell has a real start date even when eBay doesn't return one.
--
-- Rollback: drop table if exists public.active_listing_snapshots;
--           alter table public.drafts drop column if exists ebay_listed_at;

begin;

create table if not exists public.active_listing_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  active_count integer not null check (active_count >= 0),
  captured_at timestamptz not null default now(),
  primary key (user_id, snapshot_date)
);

alter table public.active_listing_snapshots enable row level security;

create policy "active_listing_snapshots_select_own" on public.active_listing_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "active_listing_snapshots_insert_own" on public.active_listing_snapshots
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "active_listing_snapshots_update_own" on public.active_listing_snapshots
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter table public.drafts add column if not exists ebay_listed_at timestamptz;

commit;
