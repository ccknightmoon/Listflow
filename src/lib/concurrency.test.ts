import { describe, expect, it } from "vitest";
import { createLimiter, mapLimit, retry } from "./concurrency";

const tick = () => new Promise((r) => setTimeout(r, 1));

describe("mapLimit", () => {
  it("keeps order and never exceeds the limit", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
  });
  it("handles an empty list", async () => {
    expect(await mapLimit([], 4, async (x) => x)).toEqual([]);
  });
});

describe("createLimiter", () => {
  it("caps in-flight work across separate callers", async () => {
    const lim = createLimiter(2);
    let active = 0;
    let peak = 0;
    const job = async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
    };
    await Promise.all([lim.run(job), lim.run(job), lim.run(job), lim.run(job), lim.run(job)]);
    expect(peak).toBe(2);
    expect(lim.active).toBe(0);
  });
  it("keeps going after a failure", async () => {
    const lim = createLimiter(1);
    await expect(lim.run(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await lim.run(async () => 5)).toBe(5);
  });
});

describe("retry", () => {
  it("retries then succeeds", async () => {
    let n = 0;
    const v = await retry(async () => { if (++n < 3) throw new Error("no"); return "ok"; }, 3, 1, async () => {});
    expect(v).toBe("ok");
    expect(n).toBe(3);
  });
  it("gives up after the last attempt", async () => {
    await expect(retry(async () => { throw new Error("nope"); }, 2, 1, async () => {})).rejects.toThrow("nope");
  });
});
