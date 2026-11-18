import { describe, it, expect } from "vitest";
import { repairGroups, checkGrouping, describeRepairs, groupsFromStarts } from "./grouping-repair";

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const allOnce = (groups: number[][], n: number) => groups.flat().sort((a, b) => a - b).join() === range(0, n - 1).join();

describe("repairGroups", () => {
  it("Sel's 28-photo batch: jacket 0-9, jersey 10-27, AI dropped photo 9", () => {
    const ai = [range(0, 8), range(10, 27)];
    expect(checkGrouping(ai, 28)).toMatchObject({ missing: [9], duplicated: [], ok: false });
    const r = repairGroups(ai, 28);
    expect(r.groups).toEqual([range(0, 9), range(10, 27)]);
    expect(r.autoPlaced).toEqual([{ photo: 9, group: 0 }]);
    expect(allOnce(r.groups, 28)).toBe(true);
    expect(describeRepairs(r)).toEqual(["Photo 10 auto-placed with item 1 — check it."]);
  });

  it("missing photo inside a group joins that group (both neighbours agree)", () => {
    const r = repairGroups([[0, 1, 3, 4], [5, 6]], 7);
    expect(r.groups).toEqual([[0, 1, 2, 3, 4], [5, 6]]);
  });

  it("missing photo at either end joins the only neighbour", () => {
    expect(repairGroups([[1, 2], [3]], 5).groups).toEqual([[0, 1, 2], [3, 4]]);
  });

  it("a run of missing photos splits by distance; a tie goes to the earlier item", () => {
    // 0-2 item A, 3-6 missing, 7-9 item B: 3,4 are closer to A; 5,6 closer to B
    expect(repairGroups([[0, 1, 2], [7, 8, 9]], 10).groups).toEqual([[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]]);
    // 0-1 A, 2-4 missing, 5-6 B: 3 is a tie (2 from each side) → earlier item A
    expect(repairGroups([[0, 1], [5, 6]], 7).groups).toEqual([[0, 1, 2, 3], [4, 5, 6]]);
  });

  it("duplicates stay in the first group they appeared in", () => {
    const r = repairGroups([[0, 1, 2], [2, 3], [3, 4]], 5);
    expect(r.groups).toEqual([[0, 1, 2], [3], [4]]);
    expect(r.duplicatesRemoved).toEqual([2, 3]);
    expect(describeRepairs(r)[0]).toMatch(/Photos 3, 4 were listed twice/);
  });

  it("drops out-of-range, negative, fractional and non-number indices", () => {
    const r = repairGroups([[0, 1, 99], [-1, 2.5, "3", 2], [null, 3]], 4);
    expect(r.groups).toEqual([[0, 1], [2], [3]]);
    expect(r.outOfRange).toEqual([99, -1, 2.5, "3", null]);
    expect(checkGrouping([[0, 1, 99], [2, 3]], 4).ok).toBe(false);
  });

  it("an empty or garbage answer puts everything in one item, flagged", () => {
    for (const bad of [[], undefined, null, "nope", [[]], [[42]]]) {
      const r = repairGroups(bad, 5);
      expect(r.unusable).toBe(true);
      expect(r.groups).toEqual([[0, 1, 2, 3, 4]]);
    }
    expect(describeRepairs(repairGroups([], 3))[0]).toMatch(/split them/);
    expect(repairGroups([], 0).groups).toEqual([]);
  });

  it("sorts photos within items and items by first photo", () => {
    expect(repairGroups([[5, 4], [2, 0, 1], [3]], 6).groups).toEqual([[0, 1, 2], [3], [4, 5]]);
  });

  it("a perfect answer passes untouched", () => {
    const ai = [[0, 1], [2, 3, 4]];
    expect(checkGrouping(ai, 5).ok).toBe(true);
    const r = repairGroups(ai, 5);
    expect(r).toMatchObject({ groups: ai, autoPlaced: [], duplicatesRemoved: [], outOfRange: [], unusable: false });
  });

  it("notices use batch-wide numbers when given offsets", () => {
    expect(describeRepairs({ autoPlaced: [{ photo: 2, group: 0 }], duplicatesRemoved: [], unusable: false }, 20, 3)).toEqual(["Photo 23 auto-placed with item 4 — check it."]);
  });
});

describe("groupsFromStarts (strict retry format)", () => {
  it("builds groups from per-photo 'starts a new item' labels", () => {
    const labels = range(0, 27).map((i) => ({ index: i, startsNewItem: i === 0 || i === 10 }));
    expect(groupsFromStarts(labels, 28)).toEqual([range(0, 9), range(10, 27)]);
  });
  it("a skipped label just means 'same item'; junk is ignored", () => {
    expect(groupsFromStarts([{ index: 3, startsNewItem: true }, { index: 77, startsNewItem: true }, "x"], 5)).toEqual([[0, 1, 2], [3, 4]]);
    expect(groupsFromStarts(null, 3)).toEqual([[0, 1, 2]]);
  });
});

import { groupingNoticeLines } from "./grouping-repair";
describe("groupingNoticeLines", () => {
  it("names each auto-placed photo with the item it ended up in", () => {
    const groups = [range(0, 9), range(10, 27)];
    expect(groupingNoticeLines(groups, [9], [], false)).toEqual(["Photo 10 auto-placed with item 1 — check it."]);
    expect(groupingNoticeLines(groups, [], [3, 3, 12], true)).toEqual([
      "Part of this batch couldn't be grouped by the AI, so those photos are in one item — split them below.",
      "Photos 4, 13 were listed twice by the AI; kept in the first item.",
    ]);
    expect(groupingNoticeLines(groups, [], [], false)).toEqual([]);
  });
});
