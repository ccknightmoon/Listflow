-- 033 (NOT APPLIED -- needs Sel's approval). Private bucket for draft photos
-- (Security 4b). Nothing uses it until NEXT_PUBLIC_PRIVATE_DRAFT_PHOTOS=1 is
-- set in Vercel; existing photos stay in the public `photos` bucket and
-- their URLs keep working.
--
-- Same per-user folder rule as `photos` (first path segment = auth.uid()),
-- but NOT public: reads need the owner's session (the app's /api/photos
-- route signs a 1-hour link) or a server-signed URL (OpenAI/eBay).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos-private', 'photos-private', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "photos_private_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos-private' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "photos_private_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos-private' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "photos_private_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos-private' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Rollback (only once no draft uses /api/photos/... links):
--   drop policy if exists "photos_private_select_own" on storage.objects;
--   drop policy if exists "photos_private_insert_own" on storage.objects;
--   drop policy if exists "photos_private_delete_own" on storage.objects;
--   delete from storage.objects where bucket_id = 'photos-private';
--   delete from storage.buckets where id = 'photos-private';
