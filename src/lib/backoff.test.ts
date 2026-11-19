import { describe, it, expect, vi } from "vitest";
import { retryDelayMs, withBackoff, MAX_BACKOFF_MS } from "./backoff";

describe("OpenAI rate-limit backoff", () => {
  const mid = () => 0.5;
  it("uses retry-after when OpenAI gives one", () => {
    expect(retryDelayMs(1, { isRateLimit: true, retryAfterMs: 3000 }, () => 0)).toBe(3000);
    expect(retryDelayMs(1, { isRateLimit: true, retryAfterMs: 99_000 }, () => 0)).toBe(MAX_BACKOFF_MS);
  });
  it("exponential with jitter otherwise, capped", () => {
    expect(retryDelayMs(1, { isRateLimit: true }, mid)).toBe(2000);
    expect(retryDelayMs(2, { isRateLimit: true }, mid)).toBe(4000);
    expect(retryDelayMs(9, { isRateLimit: true }, mid)).toBe(MAX_BACKOFF_MS);
    expect(retryDelayMs(2, { isRateLimit: false }, mid)).toBe(2000);
  });
  it("retries then succeeds; gives up after the last attempt", async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    await expect(withBackoff(async () => { if (++n < 3) throw Object.assign(new Error("429"), { isRateLimit: true }); return "ok"; }, 3, sleep)).resolves.toBe("ok");
    expect(sleep).toHaveBeenCalledTimes(2);
    await expect(withBackoff(async () => { throw new Error("boom"); }, 2, sleep)).rejects.toThrow("boom");
  });
});
