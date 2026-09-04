// A minimal in-memory cache for "paint what we last had instantly, then
// refresh quietly in the background" on the app's main list/dashboard
// screens. Deliberately module-scoped rather than sessionStorage/
// localStorage: it only needs to survive client-side navigation between
// routes within this same browser tab (so Dashboard -> Store -> Dashboard
// doesn't flash an empty loading state every single time), not a full page
// reload or a new tab.
//
// That "not a full page reload" assumption doesn't hold on mobile: mobile
// browsers routinely keep a backgrounded tab's JS alive (and this
// module-level cache with it) for a long time — hours or days — instead of
// killing it, so what feels like "reopening the app" is often still the
// same JS execution that last ran a while ago. Without an age check, that
// meant a stale snapshot (e.g. a 3-item store from two months back) could
// flash on-screen every time before the real fetch overwrote it — worse
// than just showing a loading state. MAX_AGE_MS bounds how old a cached
// value can be before it's treated as a miss.
//
// Every page that reads from this still fires its normal fetch on mount
// and overwrites whatever's here with the real response — this only
// changes what renders in the gap before that response arrives.
const MAX_AGE_MS = 2 * 60 * 1000; // 2 minutes — long enough to cover quick in-app navigation, short enough that "reopened after being away" never shows old data.

interface CacheEntry<T> {
  value: T;
  savedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function getPageCache<T>(key: string, maxAgeMs: number = MAX_AGE_MS): T | undefined {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() - entry.savedAt > maxAgeMs) return undefined;
  return entry.value;
}

export function setPageCache<T>(key: string, value: T): void {
  cache.set(key, { value, savedAt: Date.now() });
}
