import { describe, it, expect } from "vitest";
import { rowKeyAction, moveRowIndex, rangeIds, clampMenuPosition } from "./row-keys";

describe("table keyboard model", () => {
  it("maps keys to actions", () => {
    expect(rowKeyAction({ key: "ArrowDown" })).toBe("next");
    expect(rowKeyAction({ key: "k" })).toBe("prev");
    expect(rowKeyAction({ key: " " })).toBe("toggle");
    expect(rowKeyAction({ key: "Enter" })).toBe("open");
    expect(rowKeyAction({ key: "F10", shiftKey: true })).toBe("menu");
    expect(rowKeyAction({ key: "F10" })).toBeNull();
    expect(rowKeyAction({ key: "ContextMenu" })).toBe("menu");
    expect(rowKeyAction({ key: "a", metaKey: true })).toBe("selectAll");
    expect(rowKeyAction({ key: "A", ctrlKey: true })).toBe("selectAll");
    expect(rowKeyAction({ key: "c", metaKey: true })).toBeNull(); // copy still works
    expect(rowKeyAction({ key: "Tab" })).toBeNull(); // Tab order untouched
  });
  it("moves and clamps", () => {
    expect(moveRowIndex("next", 0, 3)).toBe(1);
    expect(moveRowIndex("next", 2, 3)).toBe(2);
    expect(moveRowIndex("prev", 0, 3)).toBe(0);
    expect(moveRowIndex("last", 0, 3)).toBe(2);
    expect(moveRowIndex("first", 2, 3)).toBe(0);
    expect(moveRowIndex("next", 0, 0)).toBe(-1);
  });
  it("selects shift-click ranges either direction", () => {
    const ids = ["a", "b", "c", "d"];
    expect(rangeIds(ids, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeIds(ids, "d", "a")).toEqual(["a", "b", "c", "d"]);
    expect(rangeIds(ids, null, "c")).toEqual(["c"]);
    expect(rangeIds(ids, "zz", "c")).toEqual(["c"]);
  });
  it("keeps context menus on screen", () => {
    expect(clampMenuPosition(1900, 1000, 200, 300, 1920, 1080)).toEqual({ x: 1712, y: 772 });
    expect(clampMenuPosition(-5, 10, 200, 300, 1920, 1080)).toEqual({ x: 8, y: 10 });
  });
});
