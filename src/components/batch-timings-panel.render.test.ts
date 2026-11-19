import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import BatchTimingsPanel, { withPublishSpans } from "./BatchTimingsPanel";
import { newTimings, recordSpan, summarize } from "@/lib/batch-timings";

describe("BatchTimingsPanel", () => {
  it("renders nothing before any stage ran", () => {
    expect(renderToString(createElement(BatchTimingsPanel, { timings: newTimings() }))).toBe("");
  });
  it("shows the total, upload progress and a copy button", () => {
    const t = newTimings(0);
    recordSpan(t, "compress", 0, 2000, 10);
    const html = renderToString(createElement(BatchTimingsPanel, { timings: t, upload: { done: 4, failed: 1, total: 10 } })).replace(/<!-- -->/g, "");
    expect(html).toContain("Batch timings");
    expect(html).toContain("Copy timings");
    expect(html).toContain("4 of 10");
    expect(html).toContain("1 will retry when saved");
  });
  it("folds publish spans in without touching the original", () => {
    const t = newTimings(0);
    const merged = withPublishSpans(t, [{ start: 0, end: 5000 }, { start: 1000, end: 7000 }]);
    expect(summarize(merged).rows.find((r) => r.stage === "publish")?.wallMs).toBe(7000);
    expect(t.stages.publish.count).toBe(0);
  });
});
