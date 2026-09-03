// Edge-runtime error reporting -- this covers src/middleware.ts, which runs
// on the edge runtime by default in Next.js (not Node.js). Same DSN, same
// "errors only" posture as sentry.server.config.ts.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
});
