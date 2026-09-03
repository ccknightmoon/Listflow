// Browser-side error reporting. Deliberately minimal and privacy-conscious:
// no Session Replay, no performance tracing -- just "tell us when something
// actually crashes in a user's browser." This app's data (draft photos,
// shipping addresses) has no business being screen-recorded by a
// third-party tool, so Replay is never enabled here.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
});
