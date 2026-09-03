// Accent color preference — a per-account setting (stored in
// app_settings.accent_color, synced everywhere the user signs in), unlike
// theme.ts's device-only cookie. The cookie here exists purely so this
// device's very first paint already has the right --accent (see
// layout.tsx) before the page's own fetch to /api/settings confirms it —
// the DB row is always the source of truth; call setStoredAccent whenever
// a fresh value comes back from the server (a successful save, or the
// initial GET) so this device's cache stays current.
export type AccentColor = "indigo" | "sapphire" | "emerald" | "amber" | "rose" | "teal";

export const ACCENT_PRESETS: { value: AccentColor; label: string; hex: string }[] = [
  { value: "indigo", label: "Indigo", hex: "#5645FF" },
  { value: "sapphire", label: "Sapphire", hex: "#2F80ED" },
  { value: "emerald", label: "Emerald", hex: "#1E9E74" },
  { value: "amber", label: "Amber", hex: "#D98B1E" },
  { value: "rose", label: "Rose", hex: "#E5487B" },
  { value: "teal", label: "Teal", hex: "#16B8C4" },
];

const COOKIE_NAME = "accent";

function isAccentColor(value: string): value is AccentColor {
  return ACCENT_PRESETS.some((p) => p.value === value);
}

export function getStoredAccent(): AccentColor {
  if (typeof document === "undefined") return "indigo";
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : "";
  return isAccentColor(value) ? value : "indigo";
}

export function setStoredAccent(accent: AccentColor) {
  if (typeof document === "undefined") return;
  // 1 year — same low-stakes UI preference as theme.ts's cookie.
  document.cookie = `${COOKIE_NAME}=${accent}; path=/; max-age=31536000; SameSite=Lax`;
  document.documentElement.setAttribute("data-accent", accent);
}
