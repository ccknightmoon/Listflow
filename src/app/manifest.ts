import type { MetadataRoute } from "next";

// "Add to Home Screen": opens full-screen like an app, straight to the dashboard.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Listflow — list more, faster",
    short_name: "Listflow",
    description: "AI-powered listing assistant for eBay resellers",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#101017",
    theme_color: "#101017",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
