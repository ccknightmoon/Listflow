/** @type {import('next').NextConfig} */

// The Supabase project URL is a NEXT_PUBLIC_ var (already shipped in the
// client bundle, not a secret) — read at build time so the CSP's connect-src
// can allow it by name instead of falling back to a wildcard.
const supabaseOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : "";
  } catch {
    return "";
  }
})();

// Next.js App Router still streams RSC payloads and hydration data through
// inline <script> tags (no nonce plumbing exists in this app), so script-src
// needs 'unsafe-inline' to avoid breaking every page — this is a deliberate,
// documented tradeoff, not an oversight. Everything else here is as tight as
// the app's real behavior allows:
// - img-src stays open to any https host + data: URIs because photo
//   thumbnails come from eBay's GalleryURL (varies by listing) and Supabase
//   Storage's public bucket URL, neither of which is a fixed, listable host.
// - connect-src is 'self' (every app API call is same-origin, see
//   CLAUDE.md's Notable Implementation Details) plus the Supabase origin
//   itself, since the browser Supabase client (auth session, login RPCs)
//   talks to Supabase directly, not through a Next.js API route, plus
//   Sentry's ingest host so browser-side error reports (sentry.client.
//   config.ts) aren't silently blocked by this same CSP -- a locked-down
//   connect-src blocks Sentry's own requests just as effectively as an
//   attacker's.
// - frame-ancestors 'none' + X-Frame-Options: DENY is the actual
//   clickjacking defense; object-src/base-uri/form-action are locked to
//   'none'/'self' since nothing in this app needs them looser.
// next dev's webpack bundler wraps modules in eval() for fast incremental
// rebuilds -- a strict script-src with no 'unsafe-eval' blocks that outright,
// which is why "next dev" under this CSP looks like a totally dead app in
// the browser (no click handler ever attaches, forms fall back to a plain
// HTML submit that just reloads the page). Production builds (`next build`)
// never emit eval()'d code, so this only loosens the policy in dev -- the
// deployed CSP is exactly as strict as before.
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""} https://*.ingest.us.sentry.io https://*.ingest.sentry.io`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera is used only via <input type="file" capture="environment">
  // (new-listing photo capture) — no getUserMedia() anywhere in the app —
  // but left self-permitted rather than blocked outright since it's the
  // one real device capability the app touches.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  // HSTS: Vercel serves this app over HTTPS only, so this just tells
  // browsers to skip ever trying plain HTTP on repeat visits.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig = {
  images: {
    // The app never actually uses next/image's <Image> component anywhere —
    // every photo (drafts, batch results, store listings) renders through a
    // plain <img> tag instead (see the eslint-disable comments next to each
    // one). That made the old `remotePatterns: [{ hostname: "**" }]` config
    // pure risk with no upside: it left Next's built-in image-optimization
    // route reachable and willing to fetch/transcode/cache an image from ANY
    // https host on request — exactly the setup a 2025 Next.js advisory
    // (GHSA-9g9p-9gw9-jx7f, a self-hosted image-optimizer DoS) warns about,
    // and one that isn't patched anywhere in the 14.x line — only 15.5.10+/
    // 16.1.5+ fix it. Since the feature was never used, the safer fix is to
    // turn it off outright rather than wait on a major-version upgrade.
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports -- next.config.js is CommonJS, not a module Next.js transpiles
const { withSentryConfig } = require("@sentry/nextjs/config");

// No org/project/authToken here on purpose -- those are only needed to
// upload source maps to Sentry (so stack traces show real code instead of
// minified bundles). Without them this still fully works for "an error
// happened, here's the message and where" -- source-map upload is a later,
// optional upgrade, not something this app's error monitoring depends on.
module.exports = withSentryConfig(nextConfig, {
  silent: true,
});
