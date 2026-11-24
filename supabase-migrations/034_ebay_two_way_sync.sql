-- 034 (NOT APPLIED -- needs Sel's approval). Two-way sync with eBay for
-- Trading API listings (branch feat/trading-publish).
--   drafts.ebay_revision_hash  fingerprint of the live listing's editable
--                              fields when Listflow last synced it
--   drafts.ebay_synced_at      when that was (edits after it = unsynced
--                              Listflow changes)
--   drafts.ebay_scheduled_for  "Finish on eBay": when the scheduled
--                              listing goes live
--   app_settings.ebay_events_synced_at  last GetSellerEvents sweep
-- Additive, nullable, no RLS change (existing owner-only policies apply).
-- Without it: publishing, editing in place and importing all work; the
-- "changed on eBay" refresh and conflict warning only use the fingerprint
-- taken when the editor opened, and the background sweep is skipped.
alter table public.drafts add column if not exists ebay_revision_hash text;
alter table public.drafts add column if not exists ebay_synced_at timestamptz;
alter table public.drafts add column if not exists ebay_scheduled_for timestamptz;
alter table public.app_settings add column if not exists ebay_events_synced_at timestamptz;
create index if not exists drafts_user_listing_idx on public.drafts (user_id, ebay_listing_id) where ebay_listing_id is not null;

-- Rollback:
--   drop index if exists public.drafts_user_listing_idx;
--   alter table public.app_settings drop column if exists ebay_events_synced_at;
--   alter table public.drafts drop column if exists ebay_scheduled_for;
--   alter table public.drafts drop column if exists ebay_synced_at;
--   alter table public.drafts drop column if exists ebay_revision_hash;
