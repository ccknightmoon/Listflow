-- Migration: add_login_lockout_protection
-- Originally applied directly to Supabase project ctmkjrzqdlggfcjyjxbo on
-- 2026-08-26 (via the SQL editor, not this repo — this file is a
-- retroactive record so the migration history isn't missing it). Superseded
-- by 006_lock_down_login_rpcs.sql, which tightens the GRANT at the bottom
-- of this file — see that file for why.
--
-- Brute-force login protection. The raw table is never exposed to anon/
-- authenticated directly (RLS enabled, no policies granted) — only reachable
-- through the three narrow SECURITY DEFINER functions below, each of which
-- does exactly one bounded thing keyed by a lowercased email string.

create table if not exists public.login_attempts (
  email text primary key,
  failed_count integer not null default 0,
  locked_until timestamptz,
  last_attempt_at timestamptz not null default now()
);

alter table public.login_attempts enable row level security;
-- Intentionally no policies: this table is only ever touched via the
-- SECURITY DEFINER functions below, never via direct table access.

-- Call before attempting sign-in. Tells the caller whether this email is
-- currently locked out and, if so, how many seconds remain.
create or replace function public.check_login_lockout(p_email text)
returns table(locked boolean, seconds_remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked_until timestamptz;
begin
  select locked_until into v_locked_until
  from public.login_attempts
  where email = lower(p_email);

  if v_locked_until is not null and v_locked_until > now() then
    return query select true, greatest(0, ceil(extract(epoch from (v_locked_until - now())))::integer);
  else
    return query select false, 0;
  end if;
end;
$$;

-- Call after a failed sign-in attempt. Resets the counter if the last
-- failure was over 15 minutes ago (so an old, unrelated failure doesn't
-- count against a new attempt window); otherwise increments it, locking the
-- account for 15 minutes once 5 failures land inside that window.
create or replace function public.record_failed_login(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(p_email);
  v_row public.login_attempts%rowtype;
begin
  select * into v_row from public.login_attempts where email = v_email;

  if v_row.email is null then
    insert into public.login_attempts(email, failed_count, last_attempt_at)
    values (v_email, 1, now());
    return;
  end if;

  if v_row.last_attempt_at < now() - interval '15 minutes' then
    update public.login_attempts
      set failed_count = 1, last_attempt_at = now(), locked_until = null
      where email = v_email;
    return;
  end if;

  update public.login_attempts
    set failed_count = v_row.failed_count + 1,
        last_attempt_at = now(),
        locked_until = case when v_row.failed_count + 1 >= 5
          then now() + interval '15 minutes'
          else v_row.locked_until
        end
    where email = v_email;
end;
$$;

-- Call after a SUCCESSFUL sign-in — clears the record so a legitimate user
-- who mistyped their password a few times isn't left with a stale count.
create or replace function public.clear_login_attempts(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.login_attempts where email = lower(p_email);
end;
$$;

-- Original grant — anon/authenticated could call these directly via
-- Supabase's public REST RPC endpoint. Revoked in 006_lock_down_login_rpcs.sql.
grant execute on function public.check_login_lockout(text) to anon, authenticated;
grant execute on function public.record_failed_login(text) to anon, authenticated;
grant execute on function public.clear_login_attempts(text) to anon, authenticated;
