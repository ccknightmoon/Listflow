import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: () => {} }) }));

import BottomNav from "./BottomNav";
import NewListingSheet from "./NewListingSheet";
import { ListSkeleton, EmptyState } from "./ui";

describe("shared UI renders", () => {
  it("bottom nav has the centre + button and all destinations", () => {
    const html = renderToString(createElement(BottomNav));
    expect(html).toContain('aria-label="Start a listing"');
    for (const label of ["Home", "Listings", "Sales", "Settings"]) expect(html).toContain(label);
  });
  it("new-listing sheet opens the camera directly (capture input) and offers batch", () => {
    const html = renderToString(createElement(NewListingSheet, { open: true, onClose: () => {} }));
    expect(html).toContain('capture="environment"');
    expect(html).toContain("Batch from photos");
    expect(renderToString(createElement(NewListingSheet, { open: false, onClose: () => {} }))).toBe("");
  });
  it("skeleton and empty state", () => {
    expect(renderToString(createElement(ListSkeleton, { rows: 3, label: "Loading drafts…" }))).toContain("Loading drafts…");
    expect(renderToString(createElement(EmptyState, { title: "No drafts yet", body: "Tap + to start" }))).toContain("No drafts yet");
  });
});
