"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { hasStoredAccent, setStoredAccent, toAccentColor } from "@/lib/accent";

const PUBLIC = ["/", "/login", "/privacy", "/terms", "/forgot-password", "/reset-password"];

/**
 * The accent color lives in app_settings (synced across devices); the
 * `accent` cookie is only this device's fast copy, read by the root layout
 * for a flash-free first paint. A device that had never opened Settings had
 * no cookie, so it stayed on the default color until Settings was visited.
 * This fills the cookie (and applies the color) once, on the first signed-in
 * page, and does nothing afterwards.
 */
export default function AccentSync() {
  const pathname = usePathname() ?? "";
  const isPublic = PUBLIC.includes(pathname) || pathname.startsWith("/account/pending");
  useEffect(() => {
    if (isPublic || hasStoredAccent()) return;
    let alive = true;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { accentColor?: unknown } | null) => {
        if (alive && data) setStoredAccent(toAccentColor(data.accentColor));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isPublic]);
  return null;
}
