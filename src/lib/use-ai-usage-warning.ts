"use client";

import { useEffect, useState } from "react";

export interface AiUsage {
  used: number;
  limit: number;
}

// Shared by every place that shows the "you're near your monthly AI
// limit" heads-up (src/components/BottomNav.tsx for most of the app,
// src/app/batch-upload/page.tsx directly since that page doesn't render
// BottomNav) so both stay in sync on the threshold and message wording
// instead of drifting apart. See GET /api/ai-usage and
// src/lib/ai-usage.ts for the cap itself.
const USAGE_WARNING_THRESHOLD = 0.75;

export function useAiUsageWarning() {
  const [usage, setUsage] = useState<AiUsage | null>(null);

  useEffect(() => {
    fetch("/api/ai-usage")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.used === "number" && typeof data.limit === "number" && data.limit > 0) {
          setUsage({ used: data.used, limit: data.limit });
        }
      })
      .catch(() => {});
  }, []);

  const showWarning = !!usage && usage.used / usage.limit >= USAGE_WARNING_THRESHOLD;
  const message = !usage
    ? ""
    : usage.used >= usage.limit
    ? "You've reached this month's AI usage limit — it resets on the 1st."
    : `You've used ${Math.round((usage.used / usage.limit) * 100)}% of this month's AI limit (${usage.used}/${usage.limit}) — resets on the 1st.`;

  return { usage, showWarning, message };
}
