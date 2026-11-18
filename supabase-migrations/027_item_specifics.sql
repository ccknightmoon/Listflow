-- NOT YET APPLIED -- needs Sel's approval before running.
--
-- Listing quality (Nov 2026): store the eBay item specifics the AI filled
-- for the chosen category (plus any edits), the category they were filled
-- for, and structured measurements -- so the review screens can show and
-- edit them and publishing sends them to eBay. Additive only; the app
-- works without it (those extras just aren't saved).
--
-- Shape: { "categoryId": "57988", "aspects": { "Brand": ["Carhartt"], ... },
--          "measurements": [ { "key": "pitToPit", "inches": 26, "approx": false } ] }
--
-- Rollback: alter table public.drafts drop column if exists item_specifics;

alter table public.drafts add column if not exists item_specifics jsonb;
