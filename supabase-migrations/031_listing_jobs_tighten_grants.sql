-- Applied Nov 19, 2026 right after 029. Supabase's default grants gave
-- anon/authenticated full table privileges on listing_jobs (RLS already
-- blocked writes, but TRUNCATE isn't covered by RLS). Sellers only need to
-- READ their own rows; all writes are server-side (service role).
revoke all on table public.listing_jobs from anon;
revoke insert, update, delete, truncate, references, trigger on table public.listing_jobs from authenticated;
grant select on table public.listing_jobs to authenticated;
