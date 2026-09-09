-- Lets a signed-in user read their OWN current-month AI usage row directly
-- via the normal (anon-key) Supabase client -- specifically for the "near
-- your monthly AI limit" nav banner (GET /api/ai-usage, see
-- src/components/BottomNav.tsx). ai_usage_counters previously had RLS
-- enabled with no policies at all (migration 010) so it could only be
-- touched through the SECURITY DEFINER check_and_consume_ai_usage
-- function -- this adds a READ-ONLY policy on top of that, nothing more:
-- no insert/update/delete policy exists, so call_count still can only
-- ever change through that same service_role-only function. A seller
-- reading their own usage count can't spoof or reset it.
create policy "Users can view their own AI usage"
  on public.ai_usage_counters
  for select
  using ((select auth.uid()) = user_id);
