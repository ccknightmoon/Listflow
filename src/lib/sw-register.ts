"use client";
// Registers the app-shell service worker (production only) and listens for
// its "you were redirected" message (signed out / pending deletion while a
// saved page was shown). Kill switch: NEXT_PUBLIC_DISABLE_SW=1 unregisters it.

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PUBLIC_DISABLE_SW === "1") {
    void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister())).catch(() => {});
    return;
  }
  navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { type?: string; url?: string } | null;
    if (d?.type === "listflow:redirect" && typeof d.url === "string") {
      try {
        const u = new URL(d.url);
        if (u.origin === window.location.origin) window.location.replace(u.pathname + u.search);
      } catch {
        // ignore
      }
    }
  });
  const go = () => void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}

/** Sign-out: drop every saved page and file for this device. */
export async function clearOfflineCaches(): Promise<void> {
  try {
    if (typeof caches !== "undefined") {
      for (const k of await caches.keys()) if (k.startsWith("listflow-")) await caches.delete(k);
    }
    navigator.serviceWorker?.controller?.postMessage({ type: "listflow:clear-caches" });
  } catch {
    // ignore
  }
}
