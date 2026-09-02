// Theme preference — stored as a plain (non-httpOnly) cookie rather than
// localStorage, on purpose: a cookie is readable by the server on the very
// first request, so RootLayout (a server component — see layout.tsx) can
// bake the correct `data-theme` attribute directly into the HTML it sends.
// That avoids the classic "flash of wrong theme" that localStorage-based
// approaches need an extra blocking <script> in <head> to paper over.
//
// "system" means "no explicit choice" — we delete the cookie rather than
// writing the literal string, so the CSS `@media (prefers-color-scheme)`
// rule in globals.css is what decides, and it'll keep tracking the OS-level
// setting live even without a page reload.
export type Theme = "light" | "dark" | "system";

const COOKIE_NAME = "theme";

export function getStoredTheme(): Theme {
  if (typeof document === "undefined") return "system";
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : "";
  return value === "light" || value === "dark" ? value : "system";
}

export function setStoredTheme(theme: Theme) {
  if (typeof document === "undefined") return;

  if (theme === "system") {
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
    document.documentElement.removeAttribute("data-theme");
  } else {
    // 1 year — this is a low-stakes UI preference, not a session token.
    document.cookie = `${COOKIE_NAME}=${theme}; path=/; max-age=31536000; SameSite=Lax`;
    document.documentElement.setAttribute("data-theme", theme);
  }
}
