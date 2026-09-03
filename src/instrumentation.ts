// Next.js instrumentation hook (stable since Next 14, no config flag
// needed) -- runs once per server/edge runtime startup, and is how the two
// Sentry config files above actually get loaded server-side. The browser
// picks up sentry.client.config.ts separately via the webpack plugin
// applied in next.config.js.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
