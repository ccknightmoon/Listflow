-- Phase 1 of the multi-tenant plan: real per-user data isolation.
--
-- Before this migration, "user_id" existed on drafts but was dead code
-- (always the literal string 'default-user'), and RLS on drafts/app_settings
-- only checked "are you logged in," not "is this your row" — every signed-in
-- account saw the same shared drafts. This converts user_id to a real uuid
-- FK against auth.users, backfills existing rows to the owner account,
-- rewrites RLS to auth.uid()-scoped policies, converts the app_settings
-- singleton (id=1) into one row per user, and namespaces the "photos"
-- storage bucket by user folder.
--
-- NOTE: eBay connection itself stays global/shared in this phase (Phase 2)
-- — every user still lists through the one connected eBay store. Only the
-- Listflow-side data (drafts, settings, photos) is isolated here.
--
-- Applied directly against the live project via mcp__Supabase__apply_migration
-- on 2026-09-01 (Supabase project ctmkjrzqdlggfcjyjxbo). This file is kept
-- for the repo's record — re-running it against the same database will fail
-- (columns/policies already changed), it's not idempotent by design.

begin;

-- ============================================================
-- 1. Drop old drafts policies FIRST (they reference the old text
--    user_id column, so they must go before we can drop/rename it).
--    There were two overlapping sets: a set of already-correct
--    "Users can only ... their own drafts" policies (auth.uid()::text =
--    user_id) that had been silently neutralized by a broader set of
--    "authenticated can ... drafts" policies (qual: true) added later —
--    RLS OR-combines permissive policies for the same command, so the
--    "true" policies made the correct ones moot. Both sets are replaced
--    below with one clean set.
-- ============================================================
drop policy "Users can only delete their own drafts" on public.drafts;
drop policy "Users can only insert their own drafts" on public.drafts;
drop policy "Users can only read their own drafts" on public.drafts;
drop policy "Users can only update their own drafts" on public.drafts;
drop policy "authenticated can delete drafts" on public.drafts;
drop policy "authenticated can insert drafts" on public.drafts;
drop policy "authenticated can select drafts" on public.drafts;
drop policy "authenticated can update drafts" on public.drafts;

-- ============================================================
-- 2. drafts.user_id: text 'default-user' -> uuid FK to auth.users
-- ============================================================
alter table public.drafts
  add column if not exists user_id_new uuid references auth.users(id) on delete cascade;

-- Backfill: all existing rows belong to the owner account (the only
-- account that had ever signed in at the time of this migration).
update public.drafts
set user_id_new = '6c0e7bd3-3668-4990-b8a4-70d9f6a1ac61'::uuid  -- funkyvaultvintage@gmail.com
where user_id_new is null;

do $$
begin
  if exists (select 1 from public.drafts where user_id_new is null) then
    raise exception 'Backfill incomplete: % rows still null.',
      (select count(*) from public.drafts where user_id_new is null);
  end if;
end $$;

alter table public.drafts drop column user_id;
alter table public.drafts rename column user_id_new to user_id;
alter table public.drafts alter column user_id set not null;
alter table public.drafts alter column user_id set default auth.uid();

create index if not exists drafts_user_id_idx on public.drafts (user_id);

-- Custom SKUs are unique per-seller now, not globally.
alter table public.drafts
  add constraint drafts_user_id_custom_sku_key unique (user_id, custom_sku);

-- ============================================================
-- 3. drafts RLS: clean auth.uid()-scoped policies
-- ============================================================
create policy "drafts_select_own" on public.drafts
  for select to authenticated
  using (auth.uid() = user_id);

create policy "drafts_insert_own" on public.drafts
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "drafts_update_own" on public.drafts
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "drafts_delete_own" on public.drafts
  for delete to authenticated
  using (auth.uid() = user_id);

-- ============================================================
-- 4. app_settings: singleton (id=1) -> one row per user
-- ============================================================
drop policy "authenticated can select app_settings" on public.app_settings;
drop policy "authenticated can update app_settings" on public.app_settings;

alter table public.app_settings
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

update public.app_settings
set user_id = '6c0e7bd3-3668-4990-b8a4-70d9f6a1ac61'::uuid  -- funkyvaultvintage@gmail.com
where id = 1;

alter table public.app_settings drop constraint app_settings_pkey;
alter table public.app_settings drop constraint app_settings_singleton;
alter table public.app_settings alter column user_id set not null;
alter table public.app_settings drop column id;
alter table public.app_settings add primary key (user_id);

create policy "app_settings_select_own" on public.app_settings
  for select to authenticated
  using (auth.uid() = user_id);

create policy "app_settings_insert_own" on public.app_settings
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "app_settings_update_own" on public.app_settings
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 5. storage.objects ("photos" bucket): scope to per-user folder
-- ============================================================
drop policy "authenticated users can list jpg photos" on storage.objects;
drop policy "authenticated users can upload jpg photos" on storage.objects;

create policy "photos_insert_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and storage.extension(name) = 'jpg'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos_select_own_folder" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos_delete_own_folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
