-- Priority 2 (round-2 spec, "durable batch/job state"): batch-upload's
-- progress today only ever lives in one browser tab's React state, backed
-- up to IndexedDB purely so a page refresh can restore the in-memory
-- review screen (see src/lib/batch-recovery.ts) -- there's still no
-- server-side record of a batch at all. If that tab closes for good, or
-- the seller switches devices mid-batch, the whole batch (and which items
-- already listed vs. still need to) is gone with no way to reconstruct it
-- besides re-checking each item's draft/listing status by hand.
--
-- This adds a durable, per-user record of each batch run and its
-- individual items, so a batch can be resumed, its failures retried
-- without re-processing everything that already succeeded, and reviewed
-- after the fact (see CLAUDE.md's round-2 plan for the full feature list
-- this unblocks: resumable processing, idempotent publish, retry-failed,
-- a reconciliation screen, pause/resume/cancel). This migration only adds
-- the schema -- nothing in the app writes to these tables yet, so applying
-- it is a no-op for current behavior and safe to run any time.
--
-- Run this once against the live project (Supabase SQL editor, or
-- `supabase db push` if you use the CLI locally) -- not auto-applied.

begin;

create table public.batch_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'paused', 'completed', 'canceled', 'failed')),
  total_items integer not null default 0,
  completed_items integer not null default 0,
  failed_items integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.batch_jobs is
  'One row per batch-upload run (a seller reviewing/listing a group of items together). Tracks aggregate progress so the batch can be resumed or reviewed after the tab closes.';
comment on column public.batch_jobs.status is
  'pending: created, not yet started. processing: actively listing items. paused: seller-initiated pause, can resume. completed: every item reached a terminal state. canceled: seller stopped the batch early. failed: the batch itself errored out (distinct from individual item failures, which live on batch_job_items).';

create table public.batch_job_items (
  id uuid primary key default gen_random_uuid(),
  batch_job_id uuid not null references public.batch_jobs(id) on delete cascade,
  -- Denormalized (also reachable via batch_job_id -> batch_jobs.user_id) so
  -- this table's own RLS policies don't need a join back to batch_jobs.
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Nullable: an item can fail (e.g. AI analysis) before a drafts row for
  -- it ever gets created.
  draft_id uuid references public.drafts(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'success', 'failed', 'skipped')),
  error text,
  -- A stable key for this item's eBay publish call. Generated once when the
  -- item row is created and never changed on retry, so POST /api/ebay/list
  -- can use it to make a re-submitted publish idempotent (recognize "this
  -- exact item already published, don't create a second listing") instead
  -- of relying on the caller to avoid double-submitting.
  idempotency_key text not null default gen_random_uuid()::text,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.batch_job_items is
  'One row per item within a batch_jobs run. status/error/attempt_count let a seller retry only the items that failed instead of reprocessing the whole batch.';

create index batch_job_items_batch_job_id_idx on public.batch_job_items (batch_job_id);
create index batch_jobs_user_id_status_idx on public.batch_jobs (user_id, status);

alter table public.batch_jobs enable row level security;
alter table public.batch_job_items enable row level security;

-- Same per-user ownership pattern as drafts/app_settings/ebay_connections
-- (see 003_multi_tenant_isolation.sql), written with the
-- (select auth.uid()) wrapper from the start (see 009_rls_performance.sql
-- for why -- avoids a later migration to fix the same per-row re-eval cost).
create policy "batch_jobs_select_own" on public.batch_jobs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "batch_jobs_insert_own" on public.batch_jobs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "batch_jobs_update_own" on public.batch_jobs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "batch_jobs_delete_own" on public.batch_jobs
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "batch_job_items_select_own" on public.batch_job_items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "batch_job_items_insert_own" on public.batch_job_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "batch_job_items_update_own" on public.batch_job_items
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "batch_job_items_delete_own" on public.batch_job_items
  for delete to authenticated using ((select auth.uid()) = user_id);

commit;
