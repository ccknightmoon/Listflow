import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: () => {} }) }));

import BottomNav from "./BottomNav";
import NewListingSheet from "./NewListingSheet";
import { ListSkeleton, EmptyState } from "./ui";

describe("shared UI renders", () => {
  it("bottom nav: Home, Listings, +, Sales, More — 5 slots, 44px+ targets", () => {
    const html = renderToString(createElement(BottomNav));
    expect(html).toContain('aria-label="Start a listing"');
    for (const label of ["Home", "Listings", "Sales", "More"]) expect(html).toContain(label);
    expect(html).toContain("grid-cols-5");
    expect(html).toContain("min-h-[48px]");
    expect(html).toContain("safe-area-inset-bottom");
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

describe("nav hidden on focused screens", () => {
  it("renders nothing on New Listing", async () => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ usePathname: () => "/new-listing", useRouter: () => ({ push: () => {} }) }));
    const { default: Nav } = await import("./BottomNav");
    expect(renderToString(createElement(Nav))).toBe("");
  });
});
