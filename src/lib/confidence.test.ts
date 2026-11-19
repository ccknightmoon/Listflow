import { describe, it, expect } from "vitest";
import { assessConfidence, READY_SCORE } from "./confidence";

describe("Ready vs Needs a look", () => {
  it("tag-read brand+size, category fine, nothing missing → Ready", () => {
    const c = assessConfidence({ brandFromTag: true, sizeFromTag: true, photoCount: 5 });
    expect(c).toMatchObject({ ready: true, status: "ready", score: 100 });
  });
  it("one soft doubt still Ready; two drop below the bar", () => {
    expect(assessConfidence({ brandFromTag: true, sizeFromTag: false }).ready).toBe(true);
    const c = assessConfidence({ brandFromTag: false, sizeFromTag: false, issues: ["Measurement x"] });
    expect(c.score).toBeLessThan(READY_SCORE);
    expect(c.ready).toBe(false);
  });
  it("blocking reasons name the exact field", () => {
    const c = assessConfidence({ brandFromTag: true, sizeFromTag: true, missingRequired: ["Team"], titleIssues: ["Title doesn't show the size (XL)."], issues: ["Season: \"All\" isn't one of eBay's values — pick one from the list."], categoryNeedsReview: true });
    expect(c.ready).toBe(false);
    expect(c.reasons.filter((r) => r.blocking).map((r) => r.field)).toEqual(["Category", "Season", "Team", "Title"]);
  });
  it("unbranded items aren't penalised for no brand tag", () => {
    expect(assessConfidence({ brandUnbranded: true, sizeFromTag: true }).score).toBe(100);
  });
});
