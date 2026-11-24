import { describe, it, expect, beforeEach } from "vitest";
import { loadSnapshot, saveSnapshot, clearSnapshots } from "@/lib/persisted-snapshot";

class MemStorage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

describe("persisted snapshots", () => {
  beforeEach(() => { (globalThis as { localStorage?: unknown }).localStorage = new MemStorage(); });
  it("round-trips with the owner and expires", () => {
    saveSnapshot("home", { a: 1 }, "u1", 1000);
    expect(loadSnapshot("home", 10_000, 2000)).toEqual({ value: { a: 1 }, userId: "u1", savedAt: 1000 });
    expect(loadSnapshot("home", 10_000, 20_000)).toBeNull();
  });
  it("clears only Listflow snapshots, and survives broken storage", () => {
    saveSnapshot("home", 1, "u1");
    localStorage.setItem("other", "x");
    clearSnapshots();
    expect(loadSnapshot("home")).toBeNull();
    expect(localStorage.getItem("other")).toBe("x");
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    expect(loadSnapshot("home")).toBeNull();
    expect(() => saveSnapshot("home", 1, null)).not.toThrow();
  });
});
