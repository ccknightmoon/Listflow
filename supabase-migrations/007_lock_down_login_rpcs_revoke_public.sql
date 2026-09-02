-- Follow-up to 006_lock_down_login_rpcs.sql
--
-- That migration revoked EXECUTE on the three login-lockout RPCs from the
-- `anon` and `authenticated` roles explicitly — but verifying against the
-- live database afterward (has_function_privilege) showed anon could
-- STILL execute all three. Root cause: Postgres grants EXECUTE on a newly
-- created function to the `PUBLIC` pseudo-role automatically, and every
-- role (including anon/authenticated) inherits whatever PUBLIC can do.
-- The original 005 migration's "grant execute ... to anon, authenticated"
-- was actually redundant for that reason — PUBLIC already covered it —
-- which is exactly why revoking only from anon/authenticated left the
-- functions just as publicly callable as before.
--
-- This revokes from PUBLIC too, which is the grant that actually matters.
-- Verified after applying: has_function_privilege('anon', ..., 'EXECUTE')
-- is now false for all three functions, service_role's stays true, and a
-- direct anon-key POST to /rest/v1/rpc/record_failed_login now returns
-- 401 "permission denied for function record_failed_login" — while the
-- app's own /api/auth/lockout route (service-role client) still works
-- end-to-end (tested: 5x record -> locked:true, 900s -> clear -> unlocked).
revoke execute on function public.check_login_lockout(text) from public;
revoke execute on function public.record_failed_login(text) from public;
revoke execute on function public.clear_login_attempts(text) from public;
