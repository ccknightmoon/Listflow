import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_DAILY_LIMIT_MESSAGE,
  AI_USAGE_LIMIT_MESSAGE,
  DAILY_AI_CALL_LIMIT,
  MONTHLY_AI_CALL_LIMIT,
  __resetAiUsageForTests,
  checkAndConsumeWith,
  estimateSpendUsd,
} from "./ai-usage";
import { aiUsageWarning } from "./use-ai-usage-warning";

beforeEach(() => __resetAiUsageForTests());

describe("AI usage limits", () => {
  it("uses 10k/month and a daily safety limit", () => {
    expect(MONTHLY_AI_CALL_LIMIT).toBe(10_000);
    expect(DAILY_AI_CALL_LIMIT).toBe(600);
  });

  it("calls v2 with both limits and reports a daily stop", async () => {
    const rpc = vi.fn(async () => ({ data: [{ allowed: false, remaining: 0, reason: "day", month_used: 900, day_used: 600 }], error: null }));
    const r = await checkAndConsumeWith(rpc, "u1", 1);
    expect(rpc).toHaveBeenCalledWith("check_and_consume_ai_usage_v2", expect.objectContaining({ p_daily_limit: 600, p_monthly_limit: 10_000 }));
    expect(r).toMatchObject({ allowed: false, reason: "day", message: AI_DAILY_LIMIT_MESSAGE });
  });

  it("falls back to the monthly-only check when migration 028 isn't applied, and remembers", async () => {
    const rpc = vi.fn(async (fn: string) =>
      fn === "check_and_consume_ai_usage_v2"
        ? { data: null, error: { code: "PGRST202", message: "Could not find the function" } }
        : { data: [{ allowed: false, remaining: 0 }], error: null }
    );
    const r = await checkAndConsumeWith(rpc, "u1", 1);
    expect(r).toMatchObject({ allowed: false, reason: "month", message: AI_USAGE_LIMIT_MESSAGE });
    await checkAndConsumeWith(rpc, "u1", 1);
    expect(rpc.mock.calls.filter((c) => c[0] === "check_and_consume_ai_usage_v2")).toHaveLength(1);
  });

  it("fails open on other errors", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "XX000", message: "boom" } }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await checkAndConsumeWith(rpc, "u1", 1)).allowed).toBe(true);
  });

  it("logs a spend alert once when crossing the threshold", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // $75 / $0.025 = 3000 calls
    const rpc = vi.fn(async () => ({ data: [{ allowed: true, remaining: 100, reason: null, month_used: 3000, day_used: 10 }], error: null }));
    await checkAndConsumeWith(rpc, "u1", 1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("ai_spend_alert");
    const rpc2 = vi.fn(async () => ({ data: [{ allowed: true, remaining: 100, reason: null, month_used: 3005, day_used: 10 }], error: null }));
    await checkAndConsumeWith(rpc2, "u1", 1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("estimates spend", () => {
    expect(estimateSpendUsd(100)).toBe(2.5);
  });
});

describe("usage warning banner", () => {
  it("is quiet under every threshold", () => {
    expect(aiUsageWarning({ used: 100, limit: 10_000, dayUsed: 50, dailyLimit: 600, estSpendUsd: 2.5, spendAlertUsd: 75 }).showWarning).toBe(false);
  });
  it("shows the spend alert", () => {
    const w = aiUsageWarning({ used: 3200, limit: 10_000, dayUsed: 50, dailyLimit: 600, estSpendUsd: 80, spendAlertUsd: 75 });
    expect(w.message).toContain("Spend alert");
  });
  it("warns near and at the daily limit", () => {
    expect(aiUsageWarning({ used: 600, limit: 10_000, dayUsed: 500, dailyLimit: 600 }).message).toContain("500 of today's 600");
    expect(aiUsageWarning({ used: 600, limit: 10_000, dayUsed: 600, dailyLimit: 600 }).message).toContain("today's AI safety limit");
  });
  it("still handles the old response shape", () => {
    expect(aiUsageWarning({ used: 8000, limit: 10_000 }).message).toContain("80%");
  });
});
