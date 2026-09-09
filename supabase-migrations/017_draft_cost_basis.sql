-- Optional, seller-entered cost basis for one drafted/listed item -- what
-- they paid to acquire it (thrift/estate-sale/wholesale cost). Nothing in
-- the app can infer this on its own, so it's purely manual, unlike every
-- other AI-derived field on the listing screens. Used by /sales to compute
-- a "true" net profit (after both eBay's estimated fee AND cost) alongside
-- the fee-only estimate added in migration 016.
alter table public.drafts
  add column if not exists cost_basis numeric(10, 2);

comment on column public.drafts.cost_basis is
  'Seller-entered cost of goods for this item (what they paid to acquire it). Nullable -- most items will have no cost entered. Used by the Sales page to compute true net profit alongside the estimated eBay fee.';
