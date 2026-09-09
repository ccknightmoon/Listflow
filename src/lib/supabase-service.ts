import { createClient } from "@supabase/supabase-js";

// Shared by every cron route that has to run with no signed-in user and
// read/write across every account, not just one RLS-scoped row --
// api/cron/purge-deleted-accounts and api/cron/daily-digest both need
// this. Uses the service-role key, which bypasses RLS entirely, so every
// caller of getServiceClient() is responsible for scoping its own queries
// correctly (there's no RLS safety net doing it automatically here).
export function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
