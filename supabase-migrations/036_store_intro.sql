-- 036: Store intro + "Measurements: see photos" (feat/store-intro).
--   app_settings.store_intro_enabled      put the intro at the top of every
--                                         listing description (default off)
--   app_settings.store_intro_text         the seller's intro, plain text
--   app_settings.measurements_see_photos  replace the AI's measurement list
--                                         with "See photos for measurements."
-- Additive, per user (same row/RLS as store_description_footer). Without it
-- the app still works: listings publish without an intro, and Settings shows
-- "Store intro isn't available yet" if the seller tries to save one.
alter table public.app_settings add column if not exists store_intro_enabled boolean not null default false;
alter table public.app_settings add column if not exists store_intro_text text;
alter table public.app_settings add column if not exists measurements_see_photos boolean not null default false;

-- Rollback:
-- alter table public.app_settings drop column if exists store_intro_enabled;
-- alter table public.app_settings drop column if exists store_intro_text;
-- alter table public.app_settings drop column if exists measurements_see_photos;
