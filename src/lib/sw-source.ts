// Source of the app-shell service worker served at /sw.js (see
// src/app/sw.js/route.ts). Kept as a string builder so the deploy's commit
// SHA is baked in: every deploy is a new worker, and it drops the previous
// deploy's saved pages.
//
// What it caches, only on this device (Cache Storage is per browser
// profile, never shared):
//  * /_next/static/* and icons/fonts: cache-first (file names are hashed,
//    so they never change). Kept across deploys, trimmed to ~400 files.
//  * The HTML of the main screens (Home, Listings, Drafts, Sales):
//    stale-while-revalidate. The saved page shows at once and the fresh one
//    is fetched behind it. These pages carry no account data (all numbers
//    come from /api after load). If the fresh fetch was redirected (signed
//    out, pending deletion), the saved copy is deleted and the open page is
//    told to go there.
//  * Never: /api/*, anything not GET, other sites.
export const SW_PAGE_PATHS = ["/dashboard", "/store", "/drafts", "/sales"];

export function buildServiceWorker(version: string): string {
  const v = JSON.stringify(version.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40) || "dev");
  return `/* Listflow app-shell service worker, version ${v} */
const VERSION = ${v};
const STATIC = "listflow-static-v1";
const PAGES = "listflow-pages-" + VERSION;
const PAGE_PATHS = ${JSON.stringify(SW_PAGE_PATHS)};
const MAX_STATIC = 400;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith("listflow-pages-") && k !== PAGES) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "listflow:clear-caches") {
    event.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("listflow-")).map((k) => caches.delete(k)))));
  }
});

function isStatic(url) {
  return url.pathname.startsWith("/_next/static/") || /\\.(?:woff2?|png|svg|ico|webmanifest)$/.test(url.pathname);
}

async function trimStatic(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_STATIC; i++) await cache.delete(keys[i]);
}

async function staticFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") {
    await cache.put(request, res.clone());
    trimStatic(cache);
  }
  return res;
}

async function notifyRedirect(url) {
  for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "listflow:redirect", url });
}

async function pageSWR(event, url) {
  const cache = await caches.open(PAGES);
  const key = new Request(url.origin + url.pathname);
  const cached = await cache.match(key);
  const network = fetch(event.request).then(async (res) => {
    const finalPath = res.url ? new URL(res.url).pathname : url.pathname;
    if (res.ok && !res.redirected && finalPath === url.pathname && res.type === "basic") {
      await cache.put(key, res.clone());
    } else if (res.redirected) {
      await cache.delete(key);
      if (cached) await notifyRedirect(res.url);
    }
    return res;
  });
  if (cached) {
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }
  return network;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate" && PAGE_PATHS.includes(url.pathname)) {
    event.respondWith(pageSWR(event, url));
    return;
  }
  if (isStatic(url)) event.respondWith(staticFirst(req));
});
`;
}
