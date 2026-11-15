import { describe, it, expect } from "vitest";
import { STALE_DAYS_THRESHOLD, daysSinceDate, isStale } from "./stale-listings";

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describe("stale listings", () => {
  it("returns null days-since for a missing or unparseable date", () => {
    expect(daysSinceDate(null)).toBeNull();
    expect(daysSinceDate("not-a-date")).toBeNull();
  });

  it("computes whole days since the listing started", () => {
    expect(daysSinceDate(new Date().toISOString())).toBe(0);
    expect(daysSinceDate(daysAgoIso(1))).toBe(1);
    expect(daysSinceDate(daysAgoIso(30))).toBe(30);
  });

  it("treats listings at or beyond the stale threshold as stale", () => {
    expect(isStale(daysAgoIso(30))).toBe(true); // exactly at threshold counts as stale
    expect(isStale(daysAgoIso(45))).toBe(true);
  });

  it("does not flag fresh listings as stale", () => {
    expect(isStale(daysAgoIso(3))).toBe(false);
    expect(isStale(null)).toBe(false);
  });

  it("exposes the threshold so dashboard and store views can't drift", () => {
    expect(STALE_DAYS_THRESHOLD).toBe(30);
  });
});
