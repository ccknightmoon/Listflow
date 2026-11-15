import { describe, it, expect } from "vitest";
import { assignSequentialSku, highestNumericSku, type ClaimResult } from "./sku-assign";

// Tiny in-memory stand-in for the drafts table with the same rules the real
// DB enforces: UNIQUE (user_id, custom_sku) and "claim only if null".
function fakeDb(initial: Record<string, string | null>) {
  const rows = { ...initial };
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));
  return {
    rows,
    depsFor(draftId: string) {
      return {
        readSkus: async () => { await tick(); return Object.values(rows).filter((s) => s != null); },
        tryClaim: async (candidate: string): Promise<ClaimResult> => {
          await tick();
          if (rows[draftId] != null) return { kind: "already_set" };
          if (Object.values(rows).includes(candidate)) return { kind: "conflict" };
          rows[draftId] = candidate;
          return { kind: "claimed" };
        },
        readCurrent: async () => rows[draftId] ?? null,
        sleep: () => tick(),
        random: () => 0.5,
      };
    },
  };
}

describe("highestNumericSku", () => {
  it("compares numerically, not as text", () => {
    expect(highestNumericSku(["9", "100", "25"])).toBe(100);
  });
  it("ignores non-numeric and partly numeric SKUs", () => {
    expect(highestNumericSku(["12abc", "A-7", null, " 4 "])).toBe(4);
    expect(highestNumericSku([])).toBe(0);
  });
});

describe("assignSequentialSku", () => {
  it("assigns max + 1 for a single draft", async () => {
    const db = fakeDb({ a: "1", b: "2", c: null });
    const out = await assignSequentialSku(db.depsFor("c"));
    expect(out).toEqual({ ok: true, sku: "3", attempts: 1 });
  });

  it("gives every draft a unique SKU when a whole batch lists at once", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `d${i}`);
    const db = fakeDb({ existing: "5", ...Object.fromEntries(ids.map((id) => [id, null])) });
    const results = await Promise.all(ids.map((id) => assignSequentialSku({ ...db.depsFor(id), maxAttempts: 20 })));
    expect(results.every((r) => r.ok)).toBe(true);
    const skus = ids.map((id) => db.rows[id]);
    expect(new Set(skus).size).toBe(ids.length);
    expect(skus.map(Number).sort((x, y) => x - y)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("retries after a conflict instead of failing", async () => {
    let calls = 0;
    const out = await assignSequentialSku({
      readSkus: async () => (calls === 0 ? ["1"] : ["1", "2"]),
      tryClaim: async (c) => { calls++; return c === "2" ? { kind: "conflict" } : { kind: "claimed" }; },
      readCurrent: async () => null,
      sleep: async () => {},
    });
    expect(out).toEqual({ ok: true, sku: "3", attempts: 2 });
  });

  it("returns the SKU a parallel request already gave this same draft", async () => {
    const out = await assignSequentialSku({
      readSkus: async () => ["1"],
      tryClaim: async () => ({ kind: "already_set" }),
      readCurrent: async () => "7",
      sleep: async () => {},
    });
    expect(out).toEqual({ ok: true, sku: "7", attempts: 1 });
  });

  it("stops with 'exhausted' after maxAttempts conflicts", async () => {
    const out = await assignSequentialSku({
      readSkus: async () => [],
      tryClaim: async () => ({ kind: "conflict" }),
      readCurrent: async () => null,
      sleep: async () => {},
      maxAttempts: 3,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("exhausted");
  });

  it("surfaces non-conflict database errors immediately", async () => {
    const out = await assignSequentialSku({
      readSkus: async () => [],
      tryClaim: async () => ({ kind: "error", message: "permission denied" }),
      readCurrent: async () => null,
      sleep: async () => {},
    });
    expect(out).toEqual({ ok: false, reason: "error", message: "permission denied" });
  });
});
