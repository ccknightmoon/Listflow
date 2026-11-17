import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import PriceSheet from "./PriceSheet";

const strip = (h: string) => h.replace(/<!-- -->/g, "");

describe("PriceSheet", () => {
  it("single listing: presets, custom, floor, live preview, watcher offer", () => {
    const html = strip(renderToString(createElement(PriceSheet, {
      open: true, items: [{ id: "1", title: "Tee", price: 27.99 }], thumbnail: "https://x/y.jpg", watchCount: 3, offerEligible: true,
      onClose: () => {}, onApply: () => {}, onSendOffer: async () => null,
    })));
    for (const t of ["−10%", "−15%", "−20%", "Set $", "Don&#x27;t go below $", "$23.79", "send an offer to interested buyers"]) expect(html).toContain(t);
  });
  it("bulk: summary instead of a single price, no watcher section", () => {
    const html = strip(renderToString(createElement(PriceSheet, {
      open: true, items: [{ id: "1", title: "A", price: 20 }, { id: "2", title: "B", price: 10, costBasis: 9.5 }],
      onClose: () => {}, onApply: () => {},
    })));
    expect(html).toContain("Lower 2 prices");
    expect(html).toContain("held at the floor / item cost");
    expect(html).not.toContain("interested buyers");
  });
});
