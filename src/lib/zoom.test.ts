import { describe, it, expect } from "vitest";
import { zoomAt, clampPan, toggleZoom, wheelScale, swipeDirection, wrapIndex, clampScale } from "./zoom";

describe("photo viewer zoom math", () => {
  it("keeps the point under the finger still when zooming", () => {
    const v = zoomAt({ scale: 1, x: 0, y: 0 }, 2, 100, 50);
    // screen = x + scale * imagePoint: the image point under (100,50) stays there
    expect(v.x + v.scale * 100).toBe(100);
    expect(v.y + v.scale * 50).toBe(50);
    expect(v).toEqual({ scale: 2, x: -100, y: -50 });
    expect(zoomAt(v, 1, 0, 0)).toEqual({ scale: 1, x: 0, y: 0 });
  });
  it("clamps scale and pan", () => {
    expect(clampScale(9)).toBe(5);
    expect(clampScale(0.2)).toBe(1);
    expect(clampPan({ scale: 2, x: 999, y: -999 }, 400, 800, 400, 600)).toEqual({ scale: 2, x: 200, y: -200 });
    expect(clampPan({ scale: 1, x: 50, y: 50 }, 400, 800, 400, 600)).toEqual({ scale: 1, x: 0, y: 0 });
  });
  it("double tap toggles zoom", () => {
    const z = toggleZoom({ scale: 1, x: 0, y: 0 }, 0, 0);
    expect(z.scale).toBe(2.5);
    expect(toggleZoom(z, 10, 10)).toEqual({ scale: 1, x: 0, y: 0 });
  });
  it("wheel zooms in on scroll up, out on scroll down, within limits", () => {
    expect(wheelScale(1, -100)).toBeGreaterThan(1);
    expect(wheelScale(2, 100)).toBeLessThan(2);
    expect(wheelScale(5, -1000)).toBe(5);
  });
  it("swipes change photo only when clearly horizontal", () => {
    expect(swipeDirection(-120, 10, 200)).toBe(1);
    expect(swipeDirection(120, 10, 200)).toBe(-1);
    expect(swipeDirection(-30, 0, 100)).toBe(0);
    expect(swipeDirection(-100, 90, 100)).toBe(0);
    expect(wrapIndex(-1, 5)).toBe(4);
    expect(wrapIndex(5, 5)).toBe(0);
  });
});
