// Edge-runtime error reporting. Since Next.js 16 the request gate lives in
// src/proxy.ts, which runs on the Node.js runtime (covered by
// sentry.server.config.ts); this file stays for any future edge route.
// Same DSN, same "errors only" posture as sentry.server.config.ts.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
});
