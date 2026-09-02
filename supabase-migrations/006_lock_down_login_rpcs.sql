-- Migration: lock_down_login_rpcs
--
-- Why: check_login_lockout / record_failed_login / clear_login_attempts
-- (005_login_lockout_protection.sql) are SECURITY DEFINER functions granted
-- to `anon` — meaning anyone can call them directly against Supabase's
-- public REST endpoint (POST .../rest/v1/rpc/record_failed_login) with no
-- app involvement at all. That bypasses every app-level protection this
-- app has (Upstash rate limiting in middleware.ts, the app's own request
-- handling) and hands a stranger a raw, unlimited lever to spam entries
-- into login_attempts for any email — including locking a real user out by
-- calling record_failed_login 5 times in a row.
--
-- These functions were client-called from the browser (src/app/login/page.tsx)
-- BEFORE authentication, which is *why* they were anon-grantable in the
-- first place — there's no session yet at that point for a normal RLS
-- policy to key off. The fix moves the call server-side instead: a new
-- src/app/api/auth/lockout/route.ts route now proxies these three calls
-- using the Supabase service-role key (never exposed to the browser), so
-- the RPCs themselves can be locked down to service_role only, and the
-- app's own rate limiting (src/middleware.ts) applies to every call the
-- way it does for every other endpoint.
revoke execute on function public.check_login_lockout(text) from anon, authenticated;
revoke execute on function public.record_failed_login(text) from anon, authenticated;
revoke execute on function public.clear_login_attempts(text) from anon, authenticated;

grant execute on function public.check_login_lockout(text) to service_role;
grant execute on function public.record_failed_login(text) to service_role;
grant execute on function public.clear_login_attempts(text) to service_role;
