import { describe, it, expect } from "vitest";
import { isHorizontalIntent, dragOffset, settleOffset } from "./swipe";

describe("swipe gestures", () => {
  it("waits a few px, then tells swipes from scrolls", () => {
    expect(isHorizontalIntent(3, 2)).toBeNull();
    expect(isHorizontalIntent(-30, 5)).toBe(true);
    expect(isHorizontalIntent(5, 40)).toBe(false);
  });
  it("only drags left, rubber-bands past the actions", () => {
    expect(dragOffset(0, 40, 216)).toBe(0);
    expect(dragOffset(0, -100, 216)).toBe(-100);
    expect(dragOffset(0, -316, 216)).toBe(-216 - 25);
  });
  it("settles open past halfway or on a flick", () => {
    expect(settleOffset(-120, 0, 216)).toBe(-216);
    expect(settleOffset(-90, 0, 216)).toBe(0);
    expect(settleOffset(-30, -1, 216)).toBe(-216);
    expect(settleOffset(-200, 1, 216)).toBe(0);
  });
});
