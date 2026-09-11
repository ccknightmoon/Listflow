-- Priority 5 / round-2 spec item #3: the two-tab-safe write guard on
-- drafts was dead code. PATCH /api/drafts/[id] already builds an
-- optimistic-concurrency check around `expectedUpdatedAt` -- it reads the
-- draft's `updated_at`, sends it back on save, and conditions the UPDATE
-- on `.eq("updated_at", expectedUpdatedAt)` so a save that lost a race
-- (someone else's edit landed first) gets a 409 "This draft changed in
-- another tab" instead of silently overwriting it.
--
-- The bug: the drafts table has never had an updated_at column at all. So
-- `draft.updated_at` was always undefined client-side, `expectedUpdatedAt`
-- was always omitted from the save payload, and the `.eq("updated_at", ...)`
-- filter never applied -- every PATCH succeeded unconditionally. Two tabs,
-- two devices, or a background autosave racing a manual edit could (and
-- silently would) last-write-wins clobber each other's fields with zero
-- warning, despite the code and its own 409 error message claiming
-- otherwise.
--
-- Fix is schema-only: add the column, and drive it from a trigger (not
-- from each UPDATE call site setting it by hand, the way
-- ebay_connections/app_settings do it today) because drafts gets updated
-- from several different code paths (PATCH /api/drafts/[id], the bulk
-- endpoints, POST /api/ebay/list writing ebay_listing_id on publish and
-- again on a failed relist's rollback) and a trigger guarantees every one
-- of them bumps updated_at, instead of depending on each call site to
-- remember to. No application code needs to change -- drafts/[id]/page.tsx
-- and /api/drafts/[id]/route.ts already read/send/check updated_at
-- correctly; they've just never had a real value to work with.
--
-- Safe to run any time: additive column with a default, additive trigger,
-- no existing behavior changes until a second write actually races a
-- first one.

begin;

alter table public.drafts
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists drafts_set_updated_at on public.drafts;
create trigger drafts_set_updated_at
  before update on public.drafts
  for each row
  execute function public.set_updated_at();

commit;
