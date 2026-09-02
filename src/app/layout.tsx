import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Listflow — list more, faster",
  description: "AI-powered listing assistant for eBay resellers",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Listflow",
  },
};

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

  return (
    <html lang="en" data-theme={theme}>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#185FA5" />
      </head>
      <body>{children}</body>
    </html>
  );
}
