"use client";

import { useSyncExternalStore } from "react";
import { DESKTOP_MEDIA_QUERY } from "@/lib/nav-config";

// True from the `lg` breakpoint up. Prefer plain `lg:` classes for layout;
// use this only where desktop renders different *components* (a table
// instead of swipe rows), so the DOM isn't doubled. Server render and the
// first client paint assume phone, matching today's markup exactly.
function subscribe(cb: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getSnapshot() {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
