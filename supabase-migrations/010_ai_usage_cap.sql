-- Phase 3 spending safety net: a hard per-account monthly cap on OpenAI
-- vision/text calls, enforced server-side. This is what makes it safe to
-- ever open self-service sign-up (see CLAUDE.md's "No self-service sign-up"
-- note) -- without it, a single bad-faith account could run up real OpenAI
-- charges with nothing in the app to stop it. The actual limit value lives
-- in src/lib/ai-usage.ts (MONTHLY_AI_CALL_LIMIT), not here, so it can be
-- tuned without a migration.
--
-- Locked down the same way as the login-lockout RPCs (005/006/007):
-- SECURITY DEFINER function, granted to service_role only, called from
-- server-side lib code with the service-role key -- never reachable from
-- the browser or Supabase's public REST RPC endpoint with the anon key.

create table if not exists public.ai_usage_counters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  period_month date not null default date_trunc('month', now())::date,
  call_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.ai_usage_counters enable row level security;
-- No policies -- same as login_attempts. This table is never touched
-- directly, only through the SECURITY DEFINER function below.

create or replace function public.check_and_consume_ai_usage(
  p_user_id uuid,
  p_amount integer,
  p_monthly_limit integer
) returns table(allowed boolean, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_month date := date_trunc('month', now())::date;
  v_count_before integer;
  v_new_count integer;
begin
  insert into public.ai_usage_counters (user_id, period_month, call_count)
  values (p_user_id, v_current_month, 0)
  on conflict (user_id) do nothing;

  -- Lock this user's row for the rest of this call so two concurrent
  -- requests from the same account can't both read the same starting
  -- count and both be allowed through.
  perform 1 from public.ai_usage_counters where user_id = p_user_id for update;

  -- Roll over to a fresh count if we've crossed into a new calendar month.
  update public.ai_usage_counters
    set period_month = v_current_month, call_count = 0
    where user_id = p_user_id and period_month <> v_current_month;

  select call_count into v_count_before
    from public.ai_usage_counters where user_id = p_user_id;

  v_new_count := v_count_before + p_amount;

  if v_new_count > p_monthly_limit then
    return query select false, greatest(p_monthly_limit - v_count_before, 0);
    return;
  end if;

  update public.ai_usage_counters
    set call_count = v_new_count, updated_at = now()
    where user_id = p_user_id;

  return query select true, (p_monthly_limit - v_new_count);
end;
$$;

revoke all on function public.check_and_consume_ai_usage(uuid, integer, integer) from public;
revoke all on function public.check_and_consume_ai_usage(uuid, integer, integer) from anon, authenticated;
grant execute on function public.check_and_consume_ai_usage(uuid, integer, integer) to service_role;
