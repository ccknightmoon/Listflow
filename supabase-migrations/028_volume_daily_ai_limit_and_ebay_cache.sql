-- Volume Phase 1 (PLAN-volume.md). NOT YET APPLIED -- needs Sel's approval.
-- Safe to apply any time: the app works without it (falls back to the old
-- monthly-only check and to the in-memory eBay caches) and picks it up
-- automatically once it exists. Additive only: no data is changed or removed.
--
-- 1) Daily AI safety limit. Adds a per-user, per-UTC-day counter next to the
--    existing monthly one and a v2 check function that enforces both. Same
--    lock-down as 010: SECURITY DEFINER, service_role only. The limit values
--    live in src/lib/ai-usage.ts, not here.
-- 2) eBay metadata cache. A shared copy of eBay's category suggestions and
--    item-specifics lists (public eBay catalog data, nothing per-user), so a
--    cold server doesn't have to ask eBay again. RLS on with no policies:
--    only the server (service role) can read or write it.

alter table public.ai_usage_counters
  add column if not exists day_date date,
  add column if not exists day_count integer not null default 0;

create or replace function public.check_and_consume_ai_usage_v2(
  p_user_id uuid,
  p_amount integer,
  p_monthly_limit integer,
  p_daily_limit integer
) returns table(allowed boolean, remaining integer, reason text, month_used integer, day_used integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_day date := (now() at time zone 'utc')::date;
  v_month_count integer;
  v_day_count integer;
begin
  insert into public.ai_usage_counters (user_id, period_month, call_count, day_date, day_count)
  values (p_user_id, v_month, 0, v_day, 0)
  on conflict (user_id) do nothing;

  -- Lock the row so concurrent requests can't both pass on the same count.
  perform 1 from public.ai_usage_counters where user_id = p_user_id for update;

  update public.ai_usage_counters
    set period_month = v_month, call_count = 0
    where user_id = p_user_id and period_month <> v_month;
  update public.ai_usage_counters
    set day_date = v_day, day_count = 0
    where user_id = p_user_id and (day_date is null or day_date <> v_day);

  select call_count, day_count into v_month_count, v_day_count
    from public.ai_usage_counters where user_id = p_user_id;

  if v_month_count + p_amount > p_monthly_limit then
    return query select false, greatest(least(p_monthly_limit - v_month_count, p_daily_limit - v_day_count), 0), 'month'::text, v_month_count, v_day_count;
    return;
  end if;
  if v_day_count + p_amount > p_daily_limit then
    return query select false, greatest(least(p_monthly_limit - v_month_count, p_daily_limit - v_day_count), 0), 'day'::text, v_month_count, v_day_count;
    return;
  end if;

  update public.ai_usage_counters
    set call_count = v_month_count + p_amount,
        day_count = v_day_count + p_amount,
        updated_at = now()
    where user_id = p_user_id;

  return query select true,
    least(p_monthly_limit - v_month_count - p_amount, p_daily_limit - v_day_count - p_amount),
    null::text, v_month_count + p_amount, v_day_count + p_amount;
end;
$$;

revoke all on function public.check_and_consume_ai_usage_v2(uuid, integer, integer, integer) from public;
revoke all on function public.check_and_consume_ai_usage_v2(uuid, integer, integer, integer) from anon, authenticated;
grant execute on function public.check_and_consume_ai_usage_v2(uuid, integer, integer, integer) to service_role;

create table if not exists public.ebay_metadata_cache (
  cache_key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.ebay_metadata_cache enable row level security;
-- No policies on purpose: anon/authenticated get nothing; the server uses
-- the service-role key.
revoke all on table public.ebay_metadata_cache from anon, authenticated;
