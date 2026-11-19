-- Volume Phase 3 (PLAN-volume.md): durable server-side job queue, so a
-- batch keeps processing (grouping -> analysis -> draft, and publishing)
-- with the app closed. NOT YET APPLIED -- needs Sel's approval.
--
-- Safe to apply any time and additive only. Until it exists the app keeps
-- using today's in-browser flow (the API answers "background processing
-- not available" and the batch page hides the background buttons).
--
-- Design
--   * listing_jobs: one row per unit of work (group a batch / analyze one
--     item / publish one draft). Per user, RLS: a seller can only READ their
--     own rows (for progress); every write goes through the server with the
--     service-role key.
--   * Idempotent enqueue: UNIQUE (user_id, batch_id, item_key, kind), so
--     re-sending the same item never creates a second job.
--   * Idempotent drafts: drafts.source_job_id is UNIQUE, so a retried
--     analysis job can never create a second draft for the same item.
--     Publishing is idempotent via the existing guard in the publish code
--     (a draft with an eBay listing id is never published again).
--   * Leases: a claimed job gets a lease_token and locked_until. Only the
--     holder of the current lease can finish it. If a worker dies, the
--     lease expires and the job is claimed again (crash recovery); after
--     max_attempts it goes to 'dead' ("Needs a look").
--   * Per-user concurrency: claim_listing_jobs never lets one seller have
--     more than p_per_user_limit unexpired running jobs of the given kinds.

create table if not exists public.listing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null,
  item_key text not null,
  kind text not null check (kind in ('group', 'analyze', 'publish')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'dead', 'canceled')),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  lease_token uuid,
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  draft_id uuid references public.drafts(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id, batch_id, item_key, kind)
);

create index if not exists listing_jobs_claimable_idx
  on public.listing_jobs (run_after, created_at)
  where status in ('queued', 'running');
create index if not exists listing_jobs_user_batch_idx
  on public.listing_jobs (user_id, batch_id, created_at);

alter table public.listing_jobs enable row level security;

drop policy if exists "Users can view their own listing jobs" on public.listing_jobs;
create policy "Users can view their own listing jobs"
  on public.listing_jobs
  for select
  using ((select auth.uid()) = user_id);
-- No insert/update/delete policies: writes only via the service role.

alter table public.drafts
  add column if not exists source_job_id uuid unique;

-- Claim up to p_limit jobs of the given kinds that are due (queued and
-- run_after <= now) or whose lease expired (worker crashed), respecting a
-- per-user cap on running jobs. Expired jobs that already used all their
-- attempts are dead-lettered instead of claimed.
create or replace function public.claim_listing_jobs(
  p_kinds text[],
  p_limit integer,
  p_per_user_limit integer,
  p_lease_seconds integer
) returns setof public.listing_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.listing_jobs
    set status = 'dead',
        error = coalesce(error, 'Stopped responding ' || attempts || ' times'),
        lease_token = null, locked_until = null,
        finished_at = now(), updated_at = now()
    where status = 'running'
      and locked_until < now()
      and attempts >= max_attempts
      and kind = any(p_kinds);

  return query
  with running as (
    select user_id, count(*)::integer as n
      from public.listing_jobs
      where status = 'running' and locked_until >= now() and kind = any(p_kinds)
      group by user_id
  ),
  candidates as (
    select j.id,
           row_number() over (partition by j.user_id order by j.created_at) as rn,
           coalesce(r.n, 0) as already
      from public.listing_jobs j
      left join running r on r.user_id = j.user_id
      where j.kind = any(p_kinds)
        and ((j.status = 'queued' and j.run_after <= now())
          or (j.status = 'running' and j.locked_until < now()))
  ),
  picked as (
    select id from candidates
      where rn + already <= p_per_user_limit
      order by rn, id
      limit p_limit
  )
  update public.listing_jobs j
    set status = 'running',
        attempts = j.attempts + 1,
        lease_token = gen_random_uuid(),
        locked_until = now() + make_interval(secs => p_lease_seconds),
        updated_at = now()
    from picked
    where j.id = picked.id
      -- Re-checked under the row lock, so two workers can't claim the same job.
      and ((j.status = 'queued' and j.run_after <= now())
        or (j.status = 'running' and j.locked_until < now()))
  returning j.*;
end;
$$;

revoke all on function public.claim_listing_jobs(text[], integer, integer, integer) from public;
revoke all on function public.claim_listing_jobs(text[], integer, integer, integer) from anon, authenticated;
grant execute on function public.claim_listing_jobs(text[], integer, integer, integer) to service_role;
