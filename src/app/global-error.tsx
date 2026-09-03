"use client";

// Next.js App Router's special file for catching errors that escape every
// other error boundary, including the root layout itself -- which is why
// this has to render its own <html>/<body> rather than relying on
// src/app/layout.tsx. Reports to Sentry, then shows a plain "something
// broke" screen instead of a blank white page.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "12px", padding: "24px", textAlign: "center", fontFamily: "sans-serif" }}>
          <h1 style={{ fontSize: "18px", fontWeight: 600 }}>Something went wrong.</h1>
          <p style={{ fontSize: "14px", color: "#666" }}>
            This has been reported automatically. Try again, or come back in a moment.
          </p>
          <button
            onClick={() => reset()}
            style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
