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

// Sidebar and BottomNav are both mounted (one is hidden by CSS), and
// batch-upload uses the hook too: share one request per minute instead of
// firing /api/ai-usage once per caller.
const SHARED_TTL_MS = 60_000;
let shared: { at: number; p: Promise<AiUsage | null> } | null = null;

export function parseAiUsage(data: unknown): AiUsage | null {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.used !== "number" || typeof d.limit !== "number" || !(d.limit > 0)) return null;
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    used: d.used,
    limit: d.limit,
    dayUsed: num(d.dayUsed),
    dailyLimit: num(d.dailyLimit),
    estSpendUsd: num(d.estSpendUsd),
    spendAlertUsd: num(d.spendAlertUsd),
  };
}

export function loadAiUsageShared(fetcher: () => Promise<unknown> = () => fetch("/api/ai-usage").then((r) => r.json()), now = Date.now()): Promise<AiUsage | null> {
  if (shared && now - shared.at < SHARED_TTL_MS) return shared.p;
  const p = fetcher().then(parseAiUsage).catch(() => null);
  shared = { at: now, p };
  return p;
}

export function useAiUsageWarning() {
  const [usage, setUsage] = useState<AiUsage | null>(null);

  useEffect(() => {
    let alive = true;
    void loadAiUsageShared().then((u) => {
      if (alive && u) setUsage(u);
    });
    return () => {
      alive = false;
    };
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
