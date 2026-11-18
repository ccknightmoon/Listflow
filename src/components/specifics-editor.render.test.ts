import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ categoryId: null, defs: [] })) }));
import SpecificsEditor from "./SpecificsEditor";
import AspectPicker from "./AspectPicker";
import type { AspectDef } from "@/lib/item-specifics";

const defs: AspectDef[] = [
  { name: "Team", required: true, recommended: false, mode: "SELECTION_ONLY", multi: false, values: ["Pittsburgh Steelers", "Dallas Cowboys"] },
  { name: "Size", required: true, recommended: false, mode: "FREE_TEXT", multi: false, values: ["S", "M", "L", "XL"] },
  { name: "Features", required: false, recommended: true, mode: "FREE_TEXT", multi: true, values: ["Embroidered", "Pockets"] },
  { name: "Country/Region of Manufacture", required: false, recommended: true, mode: "SELECTION_ONLY", multi: false, values: ["Mexico", "United States"] },
];
const html = (aspects: Record<string, string[]>) =>
  renderToString(createElement(SpecificsEditor, { aspects, defs, categoryId: "24511", categoryPath: "Sports Mem > Football-NFL", onChange: () => {} })).replace(/<!-- -->/g, "");

describe("item specifics use eBay-style dropdowns", () => {
  it("every specific is a dropdown trigger (no free text inputs or datalists)", () => {
    const h = html({ Team: ["Pittsburgh Steelers"], Size: ["XL"], Features: ["Embroidered"] });
    expect((h.match(/aria-haspopup="listbox"/g) ?? []).length).toBe(3); // Team, Size, Features (Country is under "Show more")
    expect(h).not.toContain("<datalist");
    expect(h).toContain("Show 1 more recommended by eBay");
    expect(h).toContain("Pittsburgh Steelers");
  });
  it("required + empty shows the badge and 'Needed to publish'", () => {
    const h = html({ Size: ["XL"] });
    expect(h).toContain("Required");
    expect(h).toContain("Needed to publish");
    expect(h).toContain("1 required missing");
  });
  it("valid values aren't flagged (USA-style synonyms are snapped server-side and here)", () => {
    const h = html({ Team: ["pittsburgh steelers"], Size: ["XL"], "Country/Region of Manufacture": ["United States"] });
    expect(h).not.toContain("doesn&#x27;t accept");
  });
  it("a value eBay would reject is flagged with a one-tap fix", () => {
    const h = html({ Team: ["Pittsburg Steelrs FC"], Size: ["XL"] });
    expect(h).toContain("doesn&#x27;t accept");
    expect(h).toMatch(/Use .{1,8}Pittsburgh Steelers/);
  });
  it("multi-value aspects show chips", () => {
    const h = renderToString(createElement(AspectPicker, { def: defs[2], values: ["Embroidered", "Pockets"], onChange: () => {} }));
    expect(h).toContain(">Embroidered</span>");
    expect(h).toContain(">Pockets</span>");
    expect(h).toContain('aria-label="Features: Embroidered, Pockets"');
  });
});
