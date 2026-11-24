import { describe, it, expect } from "vitest";
import { planTimeGroups, resolveTimeGroups, sameItemFromAiGroups } from "@/lib/time-grouping";
import { parseExifDate, parseJpegCaptureTime } from "@/lib/exif-time";

const S = 1000;

describe("planTimeGroups", () => {
  it("splits on long pauses, keeps quick shots together, no AI needed", () => {
    // item A: 0,4,8s · 2 min pause · item B: 128,133s · 90 s pause · item C
    const t = [0, 4, 8, 128, 133, 223].map((x) => x * S);
    const plan = planTimeGroups(t);
    expect(plan.usable).toBe(true);
    if (!plan.usable) return;
    expect(plan.unclear).toEqual([]);
    expect(resolveTimeGroups(plan)).toEqual([[0, 1, 2], [3, 4], [5]]);
  });

  it("orders by time even if the picker order differs", () => {
    const t = [128, 0, 4, 133].map((x) => x * S);
    const plan = planTimeGroups(t);
    if (!plan.usable) throw new Error("expected usable");
    expect(resolveTimeGroups(plan)).toEqual([[1, 2], [0, 3]]);
  });

  it("flags mid-length pauses as unclear and uses the AI answer for them", () => {
    const t = [0, 5, 10, 45, 50, 200].map((x) => x * S); // 35 s pause is unclear
    const plan = planTimeGroups(t);
    if (!plan.usable) throw new Error("expected usable");
    expect(plan.unclear.map((u) => u.k)).toEqual([2]);
    expect(plan.unclear[0].before).toEqual([0, 1, 2]);
    expect(plan.unclear[0].after).toEqual([3, 4, 5]);
    expect(resolveTimeGroups(plan)).toEqual([[0, 1, 2], [3, 4], [5]]); // default: split
    expect(resolveTimeGroups(plan, { 2: true })).toEqual([[0, 1, 2, 3, 4], [5]]);
  });

  it("refuses identical / missing times", () => {
    expect(planTimeGroups([5, 5, 5, 5].map((x) => x * S)).usable).toBe(false);
    expect(planTimeGroups([0, null, 10 * S]).usable).toBe(false);
    expect(planTimeGroups([0]).usable).toBe(false);
  });

  it("gives up when nearly every pause is unclear", () => {
    const t = Array.from({ length: 50 }, (_, i) => i * 35 * S);
    expect(planTimeGroups(t, { maxUnclear: 10 }).usable).toBe(false);
  });
});

describe("sameItemFromAiGroups", () => {
  it("is same item when the photos either side of the gap share a group", () => {
    expect(sameItemFromAiGroups([[0, 1, 2, 3]], 2)).toBe(true);
    expect(sameItemFromAiGroups([[0, 1], [2, 3]], 2)).toBe(false);
  });
});

describe("exif time", () => {
  it("parses EXIF dates", () => {
    expect(parseExifDate("2026:11:24 14:03:22")).toBe(Date.UTC(2026, 10, 24, 14, 3, 22));
    expect(parseExifDate("0000:00:00 00:00:00")).toBeNull();
    expect(parseExifDate("garbage")).toBeNull();
  });

  it("reads DateTimeOriginal + subseconds from a minimal JPEG", () => {
    // SOI, APP1 Exif with little-endian TIFF: IFD0 -> ExifIFD pointer -> 0x9003 + 0x9291
    const date = "2026:11:24 14:03:22\0"; // 20 bytes
    const sub = "25\0\0";
    const tiff: number[] = [];
    const u16 = (v: number) => tiff.push(v & 0xff, v >> 8);
    const u32 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24);
    tiff.push(0x49, 0x49); u16(42); u32(8); // header, IFD0 at 8
    u16(1); u16(0x8769); u16(4); u32(1); u32(26); u32(0); // IFD0: ExifIFD at 26
    u16(2); // ExifIFD at 26
    u16(0x9003); u16(2); u32(20); u32(26 + 2 + 24 + 4); // value offset after the IFD
    u16(0x9291); u16(2); u32(3); tiff.push(...[...sub].map((c) => c.charCodeAt(0)));
    u32(0);
    tiff.push(...[...date].map((c) => c.charCodeAt(0)));
    const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const bytes = [0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 0xff, ...app1, 0xff, 0xda, 0, 2];
    const view = new DataView(new Uint8Array(bytes).buffer);
    expect(parseJpegCaptureTime(view)).toBe(Date.UTC(2026, 10, 24, 14, 3, 22) + 250);
  });

  it("returns null for non-JPEG data", () => {
    expect(parseJpegCaptureTime(new DataView(new Uint8Array([1, 2, 3, 4]).buffer))).toBeNull();
  });
});
