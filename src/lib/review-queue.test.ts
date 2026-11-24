import { describe, it, expect } from "vitest";
import { reviewItemsFromJobs, draftIdsToList, nextUndecided, swipeDecision, needsPrice, parsePriceInput, willList, type ReviewItem } from "@/lib/review-queue";
import type { JobRow } from "@/lib/jobs/client";

const job = (over: Partial<JobRow>): JobRow => ({
  id: over.id ?? Math.random().toString(36), batch_id: "b", item_key: "0001", kind: "analyze", status: "done",
  attempts: 1, max_attempts: 3, result: null, draft_id: null, error: null, created_at: "", updated_at: "", ...over,
});

describe("reviewItemsFromJobs", () => {
  it("keeps finished, unlisted drafts in item order", () => {
    const jobs = [
      job({ item_key: "0002", draft_id: "d2", result: { title: "B", ready: false, reasons: ["Set a price"] } }),
      job({ item_key: "0001", draft_id: "d1", result: { title: "A", ready: true, price: 20, thumbnail: "t" } }),
      job({ item_key: "0003", status: "running" }),
      job({ item_key: "0004", draft_id: "d4", result: { title: "D", ready: true } }),
      job({ kind: "publish", item_key: "d4", status: "queued" }),
    ];
    const items = reviewItemsFromJobs(jobs);
    expect(items.map((i) => i.draftId)).toEqual(["d1", "d2"]);
    expect(items[0]).toMatchObject({ title: "A", price: 20, ready: true, thumbnail: "t" });
    expect(items[1].reasons).toEqual(["Set a price"]);
  });
});

describe("decisions", () => {
  const items: ReviewItem[] = [
    { draftId: "a", title: "", thumbnail: null, price: 10, ready: true, reasons: [] },
    { draftId: "b", title: "", thumbnail: null, price: null, ready: false, reasons: ["Set a price"] },
    { draftId: "c", title: "", thumbnail: null, price: 5, ready: true, reasons: [] },
  ];
  it("lists Ready items unless held, plus approved ones", () => {
    expect(draftIdsToList(items, {})).toEqual(["a", "c"]);
    expect(draftIdsToList(items, { b: "approve", c: "hold" })).toEqual(["a", "b"]);
    expect(willList(items[1], {})).toBe(false);
  });
  it("finds the next undecided card", () => {
    expect(nextUndecided(items, { a: "approve" })).toBe(1);
    expect(nextUndecided(items, { a: "approve", b: "hold", c: "hold" })).toBe(-1);
    expect(nextUndecided(items, {}, 2)).toBe(2);
  });
});

describe("swipeDecision", () => {
  it("needs a clear sideways drag", () => {
    expect(swipeDecision(150, 10, 400)).toBe("approve");
    expect(swipeDecision(-150, 10, 400)).toBe("hold");
    expect(swipeDecision(50, 0, 400)).toBeNull();
    expect(swipeDecision(150, 140, 400)).toBeNull();
  });
});

describe("price helpers", () => {
  it("flags missing prices and parses input", () => {
    expect(needsPrice({ draftId: "x", title: "", thumbnail: null, price: null, ready: false, reasons: [] })).toBe(true);
    expect(needsPrice({ draftId: "x", title: "", thumbnail: null, price: 12, ready: true, reasons: [] })).toBe(false);
    expect(parsePriceInput("$24.999")).toBe(25);
    expect(parsePriceInput("0")).toBeNull();
    expect(parsePriceInput("abc")).toBeNull();
  });
});
