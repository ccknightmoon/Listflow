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
// same JS execution that last ran a while ago, with an old snapshot (e.g.
// a 3-item store from two months back) still sitting in this Map.
//
// A first attempt at fixing this used a fixed age limit (reject anything
// older than N minutes). That had a real loophole: every page that reads
// this cache also mirrors its current state back into it on every render
// (see the setPageCache calls at each call site) — so simply reading a
// stale entry and re-rendering stamps it as fresh again, before the real
// fetch has resolved. Any revisit inside the age window resets the clock,
// so a stale value touched more often than the limit never actually
// expires — exactly what happens under repeated testing.
//
// The actual signal for "the user walked away and came back" is the tab
// being backgrounded, not a guessed time window — the browser tells us
// this directly via the Page Visibility API. Clearing the whole cache the
// moment the document goes hidden means a genuine reopen (any length of
// time later) always starts from a real loading state, while switching
// between this app's own pages while it stays foregrounded keeps the
// instant-paint behavior this cache exists for. MAX_AGE_MS stays as a
// second guard for contexts where visibilitychange doesn't fire.
//
// Every page that reads from this still fires its normal fetch on mount
// and overwrites whatever's here with the real response — this only
// changes what renders in the gap before that response arrives.
const MAX_AGE_MS = 2 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  savedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

// Guarded for SSR: App Router still evaluates "use client" page modules
// on the server for the initial render, where `document` doesn't exist.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cache.clear();
  });
}

export function getPageCache<T>(key: string, maxAgeMs: number = MAX_AGE_MS): T | undefined {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() - entry.savedAt > maxAgeMs) return undefined;
  return entry.value;
}

export function setPageCache<T>(key: string, value: T): void {
  cache.set(key, { value, savedAt: Date.now() });
}
