-- 037 (NOT APPLIED -- needs Sel's approval). Recycle bin for drafts.
--
-- Deleting a draft moves the whole row here (as JSON) and removes it from
-- public.drafts, so it disappears from every list, count and cache at
-- once. Undo / Restore puts it back with the same id. The daily cron
-- (/api/cron/purge-deleted-accounts) purges rows past purge_after (7 days)
-- for good, together with the seller's own photos nothing else uses.
--
-- Without this table the app keeps the old behaviour (permanent delete).
-- Additive only: no change to drafts or any existing policy.
create table if not exists public.draft_trash (
  id          uuid primary key,                 -- the draft's own id
  user_id     uuid not null references auth.users (id) on delete cascade,
  row         jsonb not null,                   -- the full drafts row at delete time
  photo_urls  text[] not null default '{}',     -- its photo links (kept until purge)
  deleted_at  timestamptz not null default now(),
  purge_after timestamptz not null default (now() + interval '7 days')
);

create index if not exists draft_trash_user_deleted_idx on public.draft_trash (user_id, deleted_at desc);
create index if not exists draft_trash_purge_idx on public.draft_trash (purge_after);

alter table public.draft_trash enable row level security;

create policy "draft_trash_select_own" on public.draft_trash
  for select to authenticated using (user_id = (select auth.uid()));
create policy "draft_trash_insert_own" on public.draft_trash
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "draft_trash_update_own" on public.draft_trash
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "draft_trash_delete_own" on public.draft_trash
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.draft_trash from anon;
grant select, insert, update, delete on public.draft_trash to authenticated;

-- Rollback (anything still in the bin is lost -- restore it first):
--   drop table if exists public.draft_trash;
