import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/inventory", useRouter: () => ({ push: () => {}, replace: () => {} }) }));

import InventoryHeader from "./inventory/InventoryHeader";

describe("Inventory header", () => {
  it("shows one filter per status and marks the current one", () => {
    const html = renderToString(createElement(InventoryHeader, { status: "scheduled" }));
    for (const l of ["Draft", "Scheduled", "Live", "Sold", "Ended"]) expect(html).toContain(`>${l}<`);
    expect(html).toMatch(/href="\/inventory\?status=scheduled"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/inventory\?status=scheduled"/);
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect(html).toContain("waiting to go live");
  });
});
