import { describe, it, expect, vi, afterEach } from "vitest";
import { trapTab, focusablesIn } from "./Sheet";

// Minimal stand-ins (no jsdom in this project): elements that can be
// focused, and a panel that "contains" them.
function el(name: string, opts: { hidden?: boolean } = {}) {
  const e = {
    name,
    focus: vi.fn(() => { (globalThis as { document: { activeElement: unknown } }).document.activeElement = e; }),
    classList: { contains: (c: string) => c === "hidden" && !!opts.hidden },
    getAttribute: () => null,
  };
  return e;
}
function panel(items: ReturnType<typeof el>[]) {
  return {
    querySelectorAll: () => items,
    contains: (x: unknown) => items.includes(x as never),
    focus: vi.fn(),
  } as unknown as HTMLElement;
}
const ev = (shiftKey = false) => ({ shiftKey, preventDefault: vi.fn() });

afterEach(() => { delete (globalThis as { document?: unknown }).document; });

describe("sheet focus trap (desktop modals/drawers)", () => {
  it("wraps Tab from the last control to the first, and Shift+Tab back", () => {
    const a = el("a"), b = el("b"), c = el("c");
    const p = panel([a, b, c]);
    (globalThis as { document: unknown }).document = { activeElement: c };
    const e1 = ev(false);
    trapTab(e1, p);
    expect(e1.preventDefault).toHaveBeenCalled();
    expect(a.focus).toHaveBeenCalled();

    (globalThis as { document: unknown }).document = { activeElement: a };
    const e2 = ev(true);
    trapTab(e2, p);
    expect(c.focus).toHaveBeenCalled();
  });
  it("lets Tab move normally between middle controls", () => {
    const a = el("a"), b = el("b"), c = el("c");
    (globalThis as { document: unknown }).document = { activeElement: b };
    const e = ev(false);
    trapTab(e, panel([a, b, c]));
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
  it("pulls focus back in if it escaped the dialog", () => {
    const a = el("a"), b = el("b");
    (globalThis as { document: unknown }).document = { activeElement: { name: "page-behind" } };
    trapTab(ev(false), panel([a, b]));
    expect(a.focus).toHaveBeenCalled();
  });
  it("skips hidden file inputs", () => {
    const vis = el("vis"), hid = el("hid", { hidden: true });
    expect(focusablesIn(panel([vis, hid]))).toEqual([vis]);
  });
});
