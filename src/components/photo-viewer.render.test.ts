import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import PhotoViewer from "./PhotoViewer";
import Lightbox from "./Lightbox";
import { Z } from "@/lib/z-layers";

const photos = ["https://x/1.jpg", "https://x/2.jpg", "https://x/3.jpg"];

describe("PhotoViewer", () => {
  it("opens full screen on the sheet layer at the tapped photo, with prev/next and close", () => {
    const html = renderToString(createElement(PhotoViewer, { photos, index: 1, onClose: () => {}, alt: "Tag" })).replace(/<!-- -->/g, "");
    expect(Number(html.match(/z-index:(\d+)/)?.[1])).toBe(Z.sheet);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Tag 2 of 3"');
    expect(html).toContain('src="https://x/2.jpg"');
    expect(html).toContain("2 / 3");
    for (const l of ["Previous photo", "Next photo", "Close photo", "Zoom in", "Zoom out"]) expect(html).toContain(`aria-label="${l}"`);
    expect(html).toContain("touch-action:none"); // pinch/pan handled by the viewer, not the page
  });
  it("hides navigation for a single photo and renders nothing when closed", () => {
    const one = renderToString(createElement(Lightbox, { src: "https://x/tag.jpg", onClose: () => {} }));
    expect(one).not.toContain("Next photo");
    expect(one).toContain('src="https://x/tag.jpg"');
    expect(renderToString(createElement(PhotoViewer, { photos, index: null, onClose: () => {} }))).toBe("");
    expect(renderToString(createElement(Lightbox, { src: null, onClose: () => {} }))).toBe("");
  });
});
