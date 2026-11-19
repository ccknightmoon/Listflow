// Shared database copy of eBay catalog metadata (category suggestions,
// item-specifics lists, allowed conditions) -- migration 028's
// ebay_metadata_cache table. This sits behind the in-memory caches in
// ebay-aspects.ts / ebay-category.ts so a cold server instance reads a
// saved copy instead of calling eBay again. The data is public eBay catalog
// data, the same for every seller; nothing per-user is stored here.
//
// Everything here is best-effort: if the table doesn't exist yet (028 not
// applied), env vars are missing, or the DB is slow, it quietly acts like a
// cache miss and the app calls eBay as before.
import { createClient } from "@supabase/supabase-js";

export const DB_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const READ_TIMEOUT_MS = 1500;

type Row = { payload: unknown; fetched_at: string };
export interface CacheStore {
  get(key: string): Promise<Row | null>;
  set(key: string, payload: unknown): Promise<void>;
}

let disabled = false;
let store: CacheStore | null = null;

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  return !!err && (err.code === "42P01" || err.code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(err.message ?? ""));
}

function defaultStore(): CacheStore | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const db = createClient(url, key, { auth: { persistSession: false } });
  return {
    async get(cacheKey) {
      const { data, error } = await db.from("ebay_metadata_cache").select("payload, fetched_at").eq("cache_key", cacheKey).maybeSingle();
      if (error) throw error;
      return (data as Row | null) ?? null;
    },
    async set(cacheKey, payload) {
      const { error } = await db
        .from("ebay_metadata_cache")
        .upsert({ cache_key: cacheKey, payload, fetched_at: new Date().toISOString() }, { onConflict: "cache_key" });
      if (error) throw error;
    },
  };
}

function getStore(): CacheStore | null {
  if (disabled) return null;
  if (!store) store = defaultStore();
  return store;
}

function handle(err: unknown) {
  if (isMissingTable(err as { code?: string; message?: string })) disabled = true;
  else console.error("ebay_metadata_cache:", (err as Error)?.message ?? err);
}

/** Saved copy younger than maxAgeMs, else null. Never throws. */
export async function dbCacheGet<T>(key: string, maxAgeMs = DB_CACHE_TTL_MS): Promise<T | null> {
  const s = getStore();
  if (!s) return null;
  try {
    const row = await Promise.race([s.get(key), new Promise<null>((r) => setTimeout(() => r(null), READ_TIMEOUT_MS))]);
    if (!row) return null;
    const age = Date.now() - new Date(row.fetched_at).getTime();
    return Number.isFinite(age) && age < maxAgeMs ? (row.payload as T) : null;
  } catch (err) {
    handle(err);
    return null;
  }
}

/** Saves a copy in the background. Never throws. */
export function dbCacheSet(key: string, payload: unknown): void {
  const s = getStore();
  if (!s) return;
  s.set(key, payload).catch(handle);
}

/** Tests: swap the store (null = use the real one) and re-enable. */
export function __setCacheStoreForTests(s: CacheStore | null) {
  store = s;
  disabled = false;
}
