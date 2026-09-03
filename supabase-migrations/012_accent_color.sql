-- Per-account accent color (Settings → Appearance customization). A
-- curated set of named presets rather than free-form hex, so the app's
-- CSS only ever needs a small lookup table (see globals.css [data-accent])
-- and the column can never end up holding an invalid/unreadable color.
-- Mirrors store_description_footer's shape exactly: one more nullable-ish
-- column on the existing per-user app_settings row, no new RLS needed.
alter table public.app_settings
  add column if not exists accent_color text not null default 'indigo'
  check (accent_color = any (array['indigo', 'sapphire', 'emerald', 'amber', 'rose', 'teal']));
