import { describe, expect, it } from "vitest";
import { allowRequest, clientIp, DEFAULT_LIMITS, rateLimitConfig, rateTier } from "@/lib/rate-limit-policy";

describe("rate limit policy", () => {
  it("is off unless RATE_LIMIT_ENABLED=1 AND Upstash is configured", () => {
    expect(rateLimitConfig({}).enabled).toBe(false);
    expect(rateLimitConfig({ UPSTASH_REDIS_REST_URL: "u", UPSTASH_REDIS_REST_TOKEN: "t" }).enabled).toBe(false);
    expect(rateLimitConfig({ RATE_LIMIT_ENABLED: "1" }).enabled).toBe(false);
    expect(rateLimitConfig({ RATE_LIMIT_ENABLED: "1", UPSTASH_REDIS_REST_URL: "u", UPSTASH_REDIS_REST_TOKEN: "t" }).enabled).toBe(true);
    expect(rateLimitConfig({ RATE_LIMIT_ENABLED: "1", KV_REST_API_URL: "u", KV_REST_API_TOKEN: "t" }).enabled).toBe(true);
    expect(rateLimitConfig({ RATE_LIMIT_ENABLED: "0", KV_REST_API_URL: "u", KV_REST_API_TOKEN: "t" }).enabled).toBe(false);
  });

  it("uses generous defaults and refuses overrides that would hurt normal use", () => {
    expect(rateLimitConfig({}).limits).toEqual(DEFAULT_LIMITS);
    const c = rateLimitConfig({ RATE_LIMIT_AI_PER_MIN: "5", RATE_LIMIT_BULK_PER_MIN: "1000", RATE_LIMIT_GENERAL_PER_MIN: "abc" });
    expect(c.limits.ai).toBe(DEFAULT_LIMITS.ai);
    expect(c.limits.bulk).toBe(1000);
    expect(c.limits.general).toBe(DEFAULT_LIMITS.general);
    // A 100-item batch analysed one per item fits inside a minute's AI budget.
    expect(DEFAULT_LIMITS.ai).toBeGreaterThanOrEqual(100);
  });

  it("puts each path in the right tier", () => {
    expect(rateTier("/dashboard")).toBe("skip");
    expect(rateTier("/api/cron/ebay-sync")).toBe("skip");
    expect(rateTier("/api/jobs/worker")).toBe("skip");
    expect(rateTier("/api/photos/abc/x.jpg")).toBe("skip");
    expect(rateTier("/api/billing/webhook")).toBe("skip");
    expect(rateTier("/api/ebay/callback")).toBe("skip");
    expect(rateTier("/api/auth/lockout")).toBe("auth");
    expect(rateTier("/api/analyze-item")).toBe("ai");
    expect(rateTier("/api/pricing/suggest")).toBe("ai");
    expect(rateTier("/api/analyze-batch")).toBe("bulk");
    expect(rateTier("/api/ebay/list")).toBe("bulk");
    expect(rateTier("/api/drafts/bulk")).toBe("bulk");
    expect(rateTier("/api/jobs/enqueue")).toBe("bulk");
    expect(rateTier("/api/settings")).toBe("general");
  });

  it("reads the first forwarded IP", () => {
    const h = (m: Record<string, string>) => ({ get: (n: string) => m[n] ?? null });
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
    expect(clientIp(h({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(h({}))).toBe("127.0.0.1");
  });

  it("fails open on errors and slow Redis", async () => {
    expect(await allowRequest(async () => ({ success: false }))).toBe(false);
    expect(await allowRequest(async () => ({ success: true }))).toBe(true);
    expect(await allowRequest(async () => { throw new Error("down"); })).toBe(true);
    expect(await allowRequest(() => new Promise(() => {}), 20)).toBe(true);
  });
});
