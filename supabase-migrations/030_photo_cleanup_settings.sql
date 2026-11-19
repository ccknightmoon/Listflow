-- Photo storage cleanup settings (free-plan storage: 1 GB). NOT YET
-- APPLIED -- needs Sel's approval. Additive only.
--
-- Nothing is ever deleted until this migration is applied: the cleanup code
-- reads these settings and does nothing when they don't exist.
--
-- photo_cleanup_enabled (default ON): N days after a draft is successfully
--   published, swap the draft's photo links to eBay's own hosted copies
--   (read from the live listing) and delete our stored copies. Photos of
--   unpublished drafts are never touched. If eBay's copies can't be read,
--   that draft is skipped.
-- photo_cleanup_days (default 3): see the plan notes for why 14 days doesn't
--   fit in 1 GB at ~450 photos a day.
-- photo_cleanup_orphans (default OFF): also delete stored photos that no
--   draft and no background job uses, once they're 7+ days old (left over
--   from deleted drafts or batches that were never saved).

alter table public.app_settings
  add column if not exists photo_cleanup_enabled boolean not null default true,
  add column if not exists photo_cleanup_days integer not null default 3
    check (photo_cleanup_days between 1 and 90),
  add column if not exists photo_cleanup_orphans boolean not null default false,
  add column if not exists photo_cleanup_last_run timestamptz;
