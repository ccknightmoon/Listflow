import type { Metadata } from "next";
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
  return (
    <html lang="en">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#185FA5" />
      </head>
      <body>{children}</body>
    </html>
  );
}
