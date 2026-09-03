-- Store-wide description footer (e.g. "Welcome to our store :)! ..."),
-- appended automatically to every listing's description at publish time
-- (src/lib/ebay-inventory.ts's upsertInventoryItem) without ever being
-- written into drafts.description itself. Kept separate from the
-- item-specific description so a seller writes it once here and it always
-- reflects the latest saved version, and so a draft's own description
-- field stays clean/reusable if this footer is ever changed or removed.
alter table public.app_settings
  add column if not exists store_description_footer text;
