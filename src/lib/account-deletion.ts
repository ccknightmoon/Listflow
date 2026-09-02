// Shared constant for the self-service account deletion grace period.
// Requesting deletion (POST /api/account/delete) sets
// app_settings.deletion_requested_at to now(); the account is fully purged
// (auth user + cascaded drafts/ebay_connections/app_settings + storage
// photos) this many days later by the daily cron job
// (/api/cron/purge-deleted-accounts). Logging back in and visiting
// /account/pending-deletion any time before the purge runs offers a
// one-click "Reactivate" that clears the flag.
//
// 30 days matches the pattern used by Facebook/Discord-style "soft delete"
// flows and comfortably sits inside GDPR's 1-month and CCPA's 45-day
// outer limits for actually completing a deletion request.
export const ACCOUNT_DELETION_GRACE_PERIOD_DAYS = 30;

export function purgeDateFrom(deletionRequestedAt: string): Date {
  const requested = new Date(deletionRequestedAt);
  return new Date(requested.getTime() + ACCOUNT_DELETION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
}
