-- Phase 2 of the multi-tenant plan: per-user eBay OAuth connections.
--
-- Before this migration, eBay itself was still shared — everyone listed
-- through one connected eBay account via a manually-pasted
-- EBAY_OAUTH_REFRESH_TOKEN env var (see src/lib/ebay-oauth.ts pre-Phase-2).
-- This table lets each signed-in user store their OWN encrypted eBay
-- refresh token and their OWN eBay Business Policy IDs (shipping/return),
-- looked up per-request via RLS the same way drafts/app_settings already
-- are (see 003_multi_tenant_isolation.sql).
--
-- The refresh token is stored encrypted (AES-256-GCM, node:crypto, see
-- src/lib/ebay-token-crypto.ts) as one base64 blob: iv || authTag ||
-- ciphertext concatenated — simpler than separate columns and still lets
-- decryption verify integrity, not just decrypt blindly. The encryption
-- key (EBAY_TOKEN_ENCRYPTION_KEY) lives only in Vercel env vars, never in
-- this database and never in chat.
--
-- Applied directly against the live project via mcp__Supabase__apply_migration
-- on 2026-09-01 (Supabase project ctmkjrzqdlggfcjyjxbo). Kept here for the
-- repo's record — re-running it against the same database will fail (table
-- already exists), it's not idempotent by design.

begin;

create table public.ebay_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ebay_user_id text,
  encrypted_refresh_token text not null,  -- base64(iv || authTag || ciphertext), AES-256-GCM
  shipping_free_policy_id text,
  shipping_heavy_policy_id text,
  shipping_calculated_policy_id text,
  return_policy_id text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ebay_connections enable row level security;

create policy "ebay_connections_select_own" on public.ebay_connections
  for select to authenticated using (auth.uid() = user_id);

create policy "ebay_connections_insert_own" on public.ebay_connections
  for insert to authenticated with check (auth.uid() = user_id);

create policy "ebay_connections_update_own" on public.ebay_connections
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "ebay_connections_delete_own" on public.ebay_connections
  for delete to authenticated using (auth.uid() = user_id);

commit;
