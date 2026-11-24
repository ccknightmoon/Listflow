import { buildServiceWorker } from "@/lib/sw-source";

export const dynamic = "force-static";

// App-shell service worker (src/lib/sw-source.ts). Versioned by the deploy's
// commit, never cached by the browser's HTTP cache, so each deploy updates it.
export function GET() {
  const body = buildServiceWorker(process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_ID ?? "dev");
  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
