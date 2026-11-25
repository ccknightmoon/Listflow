import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import PriceFloorFields from "./PriceFloorFields";

const strip = (h: string) => h.replace(/<!-- -->/g, "");
const render = (price: string, floor: string, extra: Record<string, unknown> = {}) =>
  strip(renderToString(createElement(PriceFloorFields, { idPrefix: "t", price, floor, onPriceChange: () => {}, onFloorChange: () => {}, ...extra })));

describe("PriceFloorFields", () => {
  it("shows both editable boxes prefilled, number pad on phones", () => {
    const html = render("28", "24");
    expect(html).toContain('value="28"');
    expect(html).toContain('value="24"');
    expect(html.match(/inputMode="decimal"/gi)?.length).toBe(2);
    expect(html).toContain("Lowest offer (floor)");
    expect(html).toContain("auto-declined");
    expect(html).not.toContain('role="alert"');
  });
  it("shows an inline error for a floor at/above the price", () => {
    expect(render("28", "30")).toContain("Floor must be lower than the price.");
  });
  it("shows an inline error for a missing price", () => {
    expect(render("", "")).toContain("Enter a price above $0.");
  });
  it("blank floor = no Best Offer; offers the AI suggestion back", () => {
    const html = render("30", "", { suggestedPrice: 28, suggestedFloor: 24 });
    expect(html).toContain("Suggested $28");
    expect(html).toContain("Suggested $24");
    expect(html).toContain('placeholder="No offers"');
  });
});
