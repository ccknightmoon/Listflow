import { describe, it, expect, vi } from "vitest";
import { loadAiUsageShared, parseAiUsage } from "@/lib/use-ai-usage-warning";

describe("loadAiUsageShared", () => {
  it("shares one request between callers within a minute", async () => {
    const fetcher = vi.fn(async () => ({ used: 5, limit: 100 }));
    const t = 10_000_000;
    const [a, b] = await Promise.all([loadAiUsageShared(fetcher, t), loadAiUsageShared(fetcher, t + 500)]);
    expect(a).toEqual(b);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await loadAiUsageShared(fetcher, t + 61_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("ignores malformed answers", () => {
    expect(parseAiUsage({ used: "x" })).toBeNull();
    expect(parseAiUsage({ used: 1, limit: 0 })).toBeNull();
    expect(parseAiUsage({ used: 1, limit: 10, dayUsed: 2 })?.dayUsed).toBe(2);
  });
});
