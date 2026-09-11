-- Persist the seller's per-item shipping choice so listing from Drafts and
-- bulk listing use the same mode chosen on the item review screen.
alter table public.drafts
  add column if not exists shipping_mode text not null default 'free';

alter table public.drafts
  drop constraint if exists drafts_shipping_mode_check;

alter table public.drafts
  add constraint drafts_shipping_mode_check
  check (shipping_mode in ('free', 'calculated', 'buyer_pays'));
