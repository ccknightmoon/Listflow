-- Settings for the once-a-day "something needs your attention" email
-- digest (see GET /api/cron/daily-digest and src/lib/email.ts). Sel asked
-- for the send time to be customizable rather than fixed, so this stores a
-- UTC hour (not a fixed daily schedule) -- the cron runs hourly and only
-- actually emails a user during their chosen hour. Settings' time picker
-- converts the seller's own local clock to/from this UTC hour client-side
-- (src/app/settings/page.tsx) rather than this app tracking an IANA
-- timezone anywhere -- simpler, at the cost of the *displayed* local time
-- potentially shifting by an hour across a DST transition (the underlying
-- UTC send hour itself never drifts).
alter table public.app_settings
  add column if not exists notification_email_enabled boolean not null default true,
  add column if not exists notification_email_hour_utc smallint not null default 13,
  add column if not exists notification_email_last_sent_at timestamptz;

comment on column public.app_settings.notification_email_enabled is
  'Opt-out toggle for the daily email digest (GET /api/cron/daily-digest). Defaults to true.';
comment on column public.app_settings.notification_email_hour_utc is
  'Hour of day (0-23, UTC) the hourly digest cron checks whether to send this user their digest. Default 13 UTC until the seller picks their own in Settings.';
comment on column public.app_settings.notification_email_last_sent_at is
  'Set only when a digest actually sends (total count > 0) -- same-day dedup guard so the hourly cron check can never double-send.';
