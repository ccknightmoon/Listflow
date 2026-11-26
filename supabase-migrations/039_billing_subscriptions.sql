-- 039 (NOT APPLIED -- needs Sel's approval). Plans / Stripe (TEST MODE).
--
-- One row per Listflow account that has (or had) a Stripe subscription.
-- Written ONLY by the server (Stripe webhook, service role); a seller can
-- read their own row. Nothing reads it while BILLING_ENABLED is unset, and
-- a missing table just means "Free" once billing is on -- so this can be
-- applied any time. Additive only.
create table if not exists public.billing_subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  plan                   text not null default 'free' check (plan in ('free', 'pro', 'power')),
  status                 text not null default 'incomplete',  -- Stripe subscription status
  seats                  integer not null default 0 check (seats between 0 and 20),
  current_period_end     timestamptz,
  livemode               boolean not null default false,
  updated_at             timestamptz not null default now()
);

alter table public.billing_subscriptions enable row level security;

create policy "billing_subscriptions_select_own" on public.billing_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
-- No insert/update/delete policies: only the service role (webhook) writes.

revoke all on public.billing_subscriptions from anon;
revoke insert, update, delete on public.billing_subscriptions from authenticated;
grant select on public.billing_subscriptions to authenticated;

-- Rollback:
--   drop table if exists public.billing_subscriptions;
