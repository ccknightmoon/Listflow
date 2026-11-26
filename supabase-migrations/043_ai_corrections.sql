-- 043 (NOT APPLIED -- needs Sel's approval). "Learn my fixes".
--
-- When a seller changes an AI value (e.g. brand "Polo RL" -> "Polo Ralph
-- Lauren") the pair is counted here. Once the same fix was made at least
-- twice (and "Learn my fixes" is ON in Settings, default OFF), new AI
-- results get it applied automatically. Only normalisation-type fields are
-- learned (brand, color, material, style, pattern, type, neckline, sleeve,
-- fit) -- never size, condition, price or flaws.
--
-- Rollback:
--   drop table if exists public.ai_corrections;
--   alter table public.app_settings drop column if exists learn_fixes_enabled;

create table if not exists public.ai_corrections (
  user_id    uuid not null references auth.users(id) on delete cascade,
  field      text not null check (field in ('brand','color','material','style','pattern','item_type','neckline','sleeve_length','fit')),
  from_value text not null check (char_length(from_value) between 1 and 120),
  to_value   text not null check (char_length(to_value) between 1 and 120),
  count      integer not null default 1 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, field, from_value, to_value)
);

alter table public.ai_corrections enable row level security;
drop policy if exists "ai_corrections_select_own" on public.ai_corrections;
drop policy if exists "ai_corrections_insert_own" on public.ai_corrections;
drop policy if exists "ai_corrections_update_own" on public.ai_corrections;
drop policy if exists "ai_corrections_delete_own" on public.ai_corrections;
create policy "ai_corrections_select_own" on public.ai_corrections
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "ai_corrections_insert_own" on public.ai_corrections
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "ai_corrections_update_own" on public.ai_corrections
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "ai_corrections_delete_own" on public.ai_corrections
  for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.ai_corrections from anon;
grant select, insert, update, delete on public.ai_corrections to authenticated;

alter table public.app_settings add column if not exists learn_fixes_enabled boolean not null default false;
