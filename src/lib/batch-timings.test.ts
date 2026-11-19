import { describe, expect, it } from "vitest";
import { formatReport, fmtMs, newTimings, recordItemServer, recordSpan, summarize, timed } from "./batch-timings";

describe("batch timings", () => {
  it("measures wall time across overlapping spans and averages work time", () => {
    const t = newTimings(0);
    recordSpan(t, "analysis", 1000, 5000);
    recordSpan(t, "analysis", 2000, 4000);
    const s = summarize(t);
    const row = s.rows.find((r) => r.stage === "analysis")!;
    expect(row.wallMs).toBe(4000);
    expect(row.avgMs).toBe(3000);
    expect(row.count).toBe(2);
    expect(s.totalMs).toBe(5000);
  });

  it("skips stages that never ran", () => {
    const t = newTimings(0);
    recordSpan(t, "compress", 0, 10, 5);
    expect(summarize(t).rows.map((r) => r.stage)).toEqual(["compress"]);
  });

  it("records spans even when the step throws", async () => {
    const t = newTimings();
    await expect(timed(t, "save", async () => { throw new Error("x"); })).rejects.toThrow();
    expect(t.stages.save.count).toBe(1);
  });

  it("averages the server breakdown and formats a report", () => {
    const t = newTimings(0);
    t.photos = 9;
    recordItemServer(t, { visionMs: 4000, tagFinderMs: 1000, photos: 9, highDetail: 6 });
    recordItemServer(t, { visionMs: 6000, photos: 7, highDetail: 6 });
    recordItemServer(t, undefined);
    recordSpan(t, "analysis", 0, 6000, 2);
    const s = summarize(t);
    expect(s.server.items).toBe(2);
    expect(s.server.avgVisionMs).toBe(5000);
    const text = formatReport(t);
    expect(text).toContain("AI analysis: 6.0 s wall");
    expect(text).toContain("Photos: 9");
  });

  it("formats durations", () => {
    expect(fmtMs(450)).toBe("450 ms");
    expect(fmtMs(1500)).toBe("1.5 s");
    expect(fmtMs(125000)).toBe("2 min 5 s");
    expect(fmtMs(null)).toBe("–");
  });
});
