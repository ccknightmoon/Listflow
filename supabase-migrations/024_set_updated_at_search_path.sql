-- NOT YET APPLIED -- needs Sel's approval before running.
--
-- Supabase security advisor (WARN, function_search_path_mutable):
-- public.set_updated_at has a role-mutable search_path. Pinning it to an
-- empty search_path means the function can't be tricked into resolving
-- names from a schema an attacker controls. The body only uses now() and
-- NEW, which resolve from pg_catalog regardless, so behaviour is unchanged.
--
-- Safe, non-destructive, reversible:
--   alter function public.set_updated_at() reset search_path;
--
-- The other advisor note (INFO, login_attempts has RLS enabled but no
-- policies) is intentional: that table is only reached through the
-- service-role lockout RPCs, so "no policies" = no direct client access.

alter function public.set_updated_at() set search_path = '';
