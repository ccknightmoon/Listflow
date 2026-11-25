-- 036 (NOT APPLIED -- needs Sel's approval). Background eBay sync state.
--   app_settings.ebay_sync_state  { lastRunAt, lastChangeAt, lastError,
--                                   unlinked: [{listingId, title, seenAt}] }
-- Lets the "Synced with eBay X min ago" indicator and the "live on eBay
-- but not in Listflow" alert follow the seller across devices, and lets
-- the server-side sync (/api/cron/ebay-sync) update them while the app is
-- closed. Without it the sync still runs; the state just lives on each
-- device. Additive, nullable; existing owner-only app_settings policies apply.
-- Works best together with 034 (ebay_events_synced_at).
alter table public.app_settings add column if not exists ebay_sync_state jsonb;

-- Rollback:
--   alter table public.app_settings drop column if exists ebay_sync_state;
