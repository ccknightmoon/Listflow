-- Persists the heavy-item / shipping-cost choice that new-listing,
-- batch-upload, and drafts/[id] all already let a seller set on screen.
-- Before this, isHeavy/shippingCost were sent to POST /api/ebay/list at
-- listing time only (never saved with the draft itself) or, on
-- drafts/[id] specifically, kept in localStorage only -- so a heavy item
-- saved as a draft (not listed immediately) silently lost the flag the
-- moment it was saved anywhere else (new-listing, batch-upload) or opened
-- on a different browser/device than the one that set it.
alter table public.drafts
  add column if not exists is_heavy boolean not null default false,
  add column if not exists shipping_cost numeric(10, 2);

comment on column public.drafts.is_heavy is
  'Whether this item was flagged heavy/oversized for shipping (affects the shipping cost estimate shown on new-listing, batch-upload, and drafts/[id]). Defaults false.';
comment on column public.drafts.shipping_cost is
  'Dollar shipping cost for a heavy item, entered or estimated on the same screens as is_heavy. Nullable -- only meaningful when is_heavy is true.';
