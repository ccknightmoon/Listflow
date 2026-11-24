import { describe, it, expect, vi } from "vitest";
import { createSwrCache } from "./swr-cache";

describe("stale-while-revalidate cache", () => {
  it("fresh → cached; stale → cached now + one background refresh; expired → waits", async () => {
    let t = 0;
    const keep = vi.fn();
    const c = createSwrCache<number>(() => t, keep);
    let n = 0;
    const f = vi.fn(async () => ++n);
    const opts = { freshMs: 100, staleMs: 1000 };

    expect((await c.get("u", opts, f)).value).toBe(1);
    t = 50;
    expect(await c.get("u", opts, f)).toMatchObject({ value: 1, stale: false });
    expect(f).toHaveBeenCalledTimes(1);

    t = 500;
    const [a, b] = await Promise.all([c.get("u", opts, f), c.get("u", opts, f)]);
    expect(a).toMatchObject({ value: 1, stale: true });
    expect(b).toMatchObject({ value: 1, stale: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(f).toHaveBeenCalledTimes(2); // one shared background refresh
    expect(keep).toHaveBeenCalled();
    expect((await c.get("u", opts, f)).value).toBe(2);

    t = 5000;
    expect(await c.get("u", opts, f)).toMatchObject({ value: 3, stale: false });
  });

  it("force and invalidate skip the cache; failures aren't cached", async () => {
    const c = createSwrCache<{ ok: boolean; n: number }>(() => 0, () => {});
    let n = 0;
    const f = async () => ({ ok: n++ > 0, n });
    const opts = { freshMs: 100, staleMs: 1000 };
    const notOk = (v: { ok: boolean }) => v.ok;
    expect((await c.get("u", opts, f, notOk)).value.ok).toBe(false);
    expect((await c.get("u", opts, f, notOk)).value.ok).toBe(true); // failure wasn't cached
    expect((await c.get("u", { ...opts, force: true }, f, notOk)).value.n).toBe(3);
    c.invalidate("u");
    expect((await c.get("u", opts, f, notOk)).value.n).toBe(4);
    c.invalidatePrefix("u");
    expect(c.size()).toBe(0);
  });
});
