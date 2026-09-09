-- Settings toggle for the optional "photographed item-divider" grouping
-- mode (Settings -> Batch upload). When on, batch-upload treats a photo
-- of a written/printed number -- a card, a tag, the outside of a poly
-- mailer, whatever the seller actually uses -- as the signal that the
-- current item's photos just ended, instead of asking AI to guess item
-- boundaries by comparing photos for visual similarity. See
-- src/app/api/detect-item-dividers/route.ts. Off by default: sellers who
-- don't shoot a numbered marker between items should see no change in
-- behavior at all.
-- Mirrors store_description_footer/accent_color's shape exactly: one more
-- column on the existing per-user app_settings row, no new RLS needed.
alter table public.app_settings
  add column if not exists auto_detect_item_dividers boolean not null default false;
