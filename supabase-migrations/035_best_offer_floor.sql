-- 035: Best Offer floor per draft (fix/editable-price-floor).
--   drafts.best_offer_floor  lowest offer the seller will take. When set,
--                            the listing goes up with Best Offer on and eBay
--                            auto-declines offers below it. NULL = no offers.
-- Additive, nullable, no RLS change (existing owner-only policies apply).
-- Without it the app still works: price edits save and list as before; the
-- floor just isn't saved and listings go up without Best Offer.
alter table public.drafts add column if not exists best_offer_floor numeric(10,2);

-- Rollback:
-- alter table public.drafts drop column if exists best_offer_floor;
