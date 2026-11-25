// Nov 25, 2026: after eBay rejected a listing the batch card stayed locked
// ("Saved" disabled every field), so the bad Size couldn't be fixed.
import { describe, it, expect } from "vitest";
import { isCardLocked, sameGroups, statusAfterEdit, statusAfterListFailure } from "./batch-card-state";

describe("batch review card lock", () => {
  it("a saved draft is NOT locked; only in-flight or listed items are", () => {
    expect(isCardLocked("saved", undefined)).toBe(false);
    expect(isCardLocked("saved", "error")).toBe(false); // the bug: eBay error after save
    expect(isCardLocked("auto", "idle")).toBe(false);
    expect(isCardLocked("saving", undefined)).toBe(true);
    expect(isCardLocked("saved", "saving")).toBe(true);
    expect(isCardLocked("saved", "listing")).toBe(true);
    expect(isCardLocked("saved", "listed")).toBe(true);
  });
  it("a failed List leaves the card editable and retryable", () => {
    expect(statusAfterListFailure("saved")).toBe("auto");
    expect(statusAfterListFailure("saving")).toBe("auto");
    expect(statusAfterListFailure("error")).toBe("error");
    expect(isCardLocked(statusAfterListFailure("saved"), "error")).toBe(false);
  });
  it("editing a saved card re-offers Save", () => {
    expect(statusAfterEdit("saved")).toBe("auto");
    expect(statusAfterEdit("auto")).toBe("auto");
  });
});

describe("per-item state is only kept for the same items", () => {
  it("compares photo groups exactly", () => {
    expect(sameGroups([[0, 1], [2]], [[0, 1], [2]])).toBe(true);
    expect(sameGroups(null, [[0]])).toBe(false);
    expect(sameGroups([[0, 1], [2]], [[0], [1, 2]])).toBe(false);
    expect(sameGroups([[0]], [[0], [1]])).toBe(false);
  });
});
