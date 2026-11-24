import { describe, it, expect } from "vitest";
import { salesNeedsRefresh, SALES_MAX_AGE_MS } from "@/lib/sales-freshness";

describe("salesNeedsRefresh", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  it("is false for a recent copy", () => {
    expect(salesNeedsRefresh(new Date(now - 60_000).toISOString(), now)).toBe(false);
  });
  it("is true once the copy reaches the max age", () => {
    expect(salesNeedsRefresh(new Date(now - SALES_MAX_AGE_MS).toISOString(), now)).toBe(true);
  });
  it("is true for missing or unreadable timestamps", () => {
    expect(salesNeedsRefresh(null, now)).toBe(true);
    expect(salesNeedsRefresh("nope", now)).toBe(true);
  });
});
