// Server-side error reporting. Runs on every Node.js API route/page render.
// See CLAUDE.md's "Error monitoring" note for why this exists.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Errors only -- this app has no need for Sentry's performance/tracing
  // product, and 0 keeps it from sampling/sending anything beyond crashes.
  tracesSampleRate: 0,
});
