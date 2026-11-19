"use client";

import { useEffect, useState } from "react";

export interface AiUsage {
  used: number;
  limit: number;
  dayUsed?: number;
  dailyLimit?: number;
  estSpendUsd?: number;
  spendAlertUsd?: number;
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
          setUsage({
            used: data.used,
            limit: data.limit,
            dayUsed: typeof data.dayUsed === "number" ? data.dayUsed : undefined,
            dailyLimit: typeof data.dailyLimit === "number" ? data.dailyLimit : undefined,
            estSpendUsd: typeof data.estSpendUsd === "number" ? data.estSpendUsd : undefined,
            spendAlertUsd: typeof data.spendAlertUsd === "number" ? data.spendAlertUsd : undefined,
          });
        }
      })
      .catch(() => {});
  }, []);

  const { showWarning, message } = aiUsageWarning(usage);

  return { usage, showWarning, message };
}

const DAILY_WARNING_THRESHOLD = 0.8;

/** Pure: which heads-up (if any) to show for this usage. Most urgent first. */
export function aiUsageWarning(usage: AiUsage | null): { showWarning: boolean; message: string } {
  if (!usage) return { showWarning: false, message: "" };
  if (usage.used >= usage.limit) {
    return { showWarning: true, message: "You've reached this month's AI usage limit — it resets on the 1st." };
  }
  if (usage.dailyLimit && usage.dayUsed !== undefined && usage.dayUsed >= usage.dailyLimit) {
    return { showWarning: true, message: `You've reached today's AI safety limit (${usage.dailyLimit} calls) — it resets at midnight UTC.` };
  }
  if (usage.spendAlertUsd && usage.estSpendUsd !== undefined && usage.estSpendUsd >= usage.spendAlertUsd) {
    return {
      showWarning: true,
      message: `Spend alert: about $${usage.estSpendUsd.toFixed(0)} of estimated AI cost this month (alert set at $${usage.spendAlertUsd}). Check OpenAI's usage page for the exact bill.`,
    };
  }
  if (usage.used / usage.limit >= USAGE_WARNING_THRESHOLD) {
    return {
      showWarning: true,
      message: `You've used ${Math.round((usage.used / usage.limit) * 100)}% of this month's AI limit (${usage.used}/${usage.limit}) — resets on the 1st.`,
    };
  }
  if (usage.dailyLimit && usage.dayUsed !== undefined && usage.dayUsed / usage.dailyLimit >= DAILY_WARNING_THRESHOLD) {
    return { showWarning: true, message: `You've used ${usage.dayUsed} of today's ${usage.dailyLimit} AI calls — the daily safety limit resets at midnight UTC.` };
  }
  return { showWarning: false, message: "" };
}
