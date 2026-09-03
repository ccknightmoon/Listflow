import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Bricolage_Grotesque, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Self-hosted by Next at build time (no runtime request, no flash of
// unstyled text) — Bricolage Grotesque for headings/display, Plus Jakarta
// Sans for body copy. Exposed as CSS variables so globals.css controls
// where each is actually used.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Listflow — list more, faster",
  description: "AI-powered listing assistant for eBay resellers",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Listflow",
  },
};

const ACCENT_VALUES = ["indigo", "sapphire", "emerald", "amber", "rose", "teal"];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read the theme cookie on the server so the very first byte of HTML
  // already carries the right data-theme attribute — no flash of the
  // wrong theme, and no blocking <script> needed in <head>. "system" (or
  // no cookie at all) means: no attribute, let the prefers-color-scheme
  // media query in globals.css decide. See src/lib/theme.ts.
  const themeCookie = cookies().get("theme")?.value;
  const theme = themeCookie === "light" || themeCookie === "dark" ? themeCookie : undefined;

  // Same zero-flash trick for the accent color, except the source of
  // truth is app_settings.accent_color (per-account, synced across
  // devices) — this cookie is only a fast local mirror so the very first
  // paint on this device already has the right --accent, before the
  // Settings/dashboard fetch confirms it. See src/lib/accent.ts. No
  // cookie yet (new account, or a device that's never loaded Settings)
  // means: no attribute, and :root's own default (indigo) applies.
  const accentCookie = cookies().get("accent")?.value;
  const accent = accentCookie && ACCENT_VALUES.includes(accentCookie) ? accentCookie : undefined;

  return (
    <html lang="en" data-theme={theme} data-accent={accent} className={`${bricolage.variable} ${jakarta.variable}`}>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#185FA5" />
      </head>
      <body>{children}</body>
    </html>
  );
}
