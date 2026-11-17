import { describe, it, expect } from "vitest";
import { Z } from "./z-layers";
import { anyOverlayOpen, openOverlay } from "./overlays";

describe("one z-index scale", () => {
  it("content < sticky < action bars < nav < tray < sheets < confirm < toasts", () => {
    const order = [Z.content, Z.popover, Z.sticky, Z.actionBar, Z.nav, Z.tray, Z.sheet, Z.confirm, Z.toast];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length); // no ties
  });
  it("tracks open overlays (nav/tray hide while any is open), balanced and idempotent", () => {
    expect(anyOverlayOpen()).toBe(false);
    const a = openOverlay();
    const b = openOverlay();
    expect(anyOverlayOpen()).toBe(true);
    a(); a(); // double release is harmless
    expect(anyOverlayOpen()).toBe(true);
    b();
    expect(anyOverlayOpen()).toBe(false);
  });
});
