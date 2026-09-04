// A minimal in-memory cache for "paint what we last had instantly, then
// refresh quietly in the background" on the app's main list/dashboard
// screens. Deliberately module-scoped rather than sessionStorage/
// localStorage: it only needs to survive client-side navigation between
// routes within this same browser tab (so Dashboard -> Store -> Dashboard
// doesn't flash an empty loading state every single time), not a full page
// reload or a new tab — reloading the page should always show a freshly
// fetched screen, never data left over from earlier in the session.
//
// Every page that reads from this still fires its normal fetch on mount
// and overwrites whatever's here with the real response — this only
// changes what renders in the gap before that response arrives.
const cache = new Map<string, unknown>();

export function getPageCache<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

export function setPageCache<T>(key: string, value: T): void {
  cache.set(key, value);
}
