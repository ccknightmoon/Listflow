import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AutoGrowTextarea, EbayDescriptionMock, SaveRow, nearLimitCount } from "./SettingsTextCard";

const html = (el: ReturnType<typeof createElement>) => renderToString(el).replace(/<!-- -->/g, "");

describe("EbayDescriptionMock", () => {
  it("shows where the intro lands without repeating the text", () => {
    const out = html(createElement(EbayDescriptionMock, { highlight: "intro", onPreview: () => {} }));
    expect(out).toContain("eBay · Description");
    const order = ["Your store intro", "Item details &amp; measurements", "Shipping &amp; returns"].map((l) => out.indexOf(l));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order); // intro first, shipping last
    expect(out).toMatch(/data-block="intro"[^>]*|style="[^"]*var\(--accent\)[^"]*"[^>]*data-block="intro"/);
    expect(out).toContain("Preview full description");
  });
  it("dims when the switch is off", () => {
    expect(html(createElement(EbayDescriptionMock, { highlight: "intro", dimmed: true }))).toContain("opacity:0.45");
  });
});

describe("SaveRow", () => {
  const base = { saving: false, error: null, onSave: () => {} };
  it("disabled until there are changes, then shows Saved ✓", () => {
    expect(html(createElement(SaveRow, { ...base, dirty: false, saved: false }))).toMatch(/disabled=""[^>]*>Save</);
    const dirty = html(createElement(SaveRow, { ...base, dirty: true, saved: false }));
    expect(dirty).not.toContain('disabled=""');
    expect(dirty).toContain("Unsaved changes");
    expect(html(createElement(SaveRow, { ...base, dirty: false, saved: true }))).toContain("Saved");
  });
  it("count only near the limit", () => {
    expect(nearLimitCount(444, 2000)).toBeNull();
    expect(nearLimitCount(1800, 2000)).toBe("1800/2000");
  });
});

describe("AutoGrowTextarea", () => {
  it("never scrolls inside (grows instead)", () => {
    const out = html(createElement(AutoGrowTextarea, { value: "a\nb", onChange: () => {} }));
    expect(out).toContain("overflow-hidden");
    expect(out).toContain("resize-none");
  });
});
