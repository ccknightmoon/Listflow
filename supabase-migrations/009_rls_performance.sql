-- Fixes the Supabase advisor warning "auth_rls_initplan": RLS policies on
-- drafts/app_settings/ebay_connections called auth.uid() directly in their
-- USING/WITH CHECK clauses, which Postgres re-evaluates once PER ROW rather
-- than once per query. Invisible with a handful of test rows; a real,
-- measurable drag once an account's drafts/connections tables have hundreds
-- of rows and the app has real concurrent traffic. Wrapping it as
-- (select auth.uid()) lets Postgres cache the value for the whole query
-- instead. No access-rule change -- same "only your own row" behavior,
-- just cheaper to check at scale. See CLAUDE.md's public-launch-readiness
-- notes (Sept 2026) for the rest of that audit.

alter policy drafts_select_own on public.drafts
  using ((select auth.uid()) = user_id);
alter policy drafts_insert_own on public.drafts
  with check ((select auth.uid()) = user_id);
alter policy drafts_update_own on public.drafts
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy drafts_delete_own on public.drafts
  using ((select auth.uid()) = user_id);

alter policy app_settings_select_own on public.app_settings
  using ((select auth.uid()) = user_id);
alter policy app_settings_insert_own on public.app_settings
  with check ((select auth.uid()) = user_id);
alter policy app_settings_update_own on public.app_settings
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy ebay_connections_select_own on public.ebay_connections
  using ((select auth.uid()) = user_id);
alter policy ebay_connections_insert_own on public.ebay_connections
  with check ((select auth.uid()) = user_id);
alter policy ebay_connections_update_own on public.ebay_connections
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy ebay_connections_delete_own on public.ebay_connections
  using ((select auth.uid()) = user_id);
