import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import DraftExtrasFields from "./DraftExtrasFields";
import HaulsPanel, { salesToHaulSales } from "./business/HaulsPanel";

describe("DraftExtrasFields", () => {
  it("is hidden until the database has the columns", () => {
    expect(renderToString(createElement(DraftExtrasFields, { draftId: "d", bin: undefined, autoOfferOptIn: undefined }))).toBe("");
  });
  it("shows bin + opt-in (opt-in unchecked by default)", () => {
    const html = renderToString(createElement(DraftExtrasFields, { draftId: "d", bin: "B3", autoOfferOptIn: false }));
    expect(html).toContain("Bin / shelf");
    expect(html).toContain('value="B3"');
    expect(html).toContain("Include in automatic offers");
    expect(html).not.toContain("checked");
  });
  it("shows only what exists", () => {
    const html = renderToString(createElement(DraftExtrasFields, { draftId: "d", bin: null, autoOfferOptIn: undefined }));
    expect(html).toContain("Bin / shelf");
    expect(html).not.toContain("automatic offers");
  });
});

describe("HaulsPanel", () => {
  it("renders a loading state first", () => {
    expect(renderToString(createElement(HaulsPanel))).toContain("Loading hauls");
  });
  it("maps sales with real fee or estimate", () => {
    const base = { key: "k", title: "t", qty: 1, shippingPaid: 0, taxPaid: 0, soldAt: "2026-11-01", listedAt: null, ebayCategory: null, storeCategoryName: null, itemType: null, costBasis: null };
    const r = salesToHaulSales([{ ...base, listingId: "1", itemTotal: 100, actualFee: 12 }, { ...base, listingId: "2", itemTotal: 100, actualFee: null }], 10);
    expect(r[0]).toEqual({ listingId: "1", itemTotal: 100, fee: 12 });
    expect(r[1].fee).toBeGreaterThan(0);
  });
});

import AutomationSettings, { Switch } from "./AutomationSettings";
import { EbayPermissionsView } from "./EbayPermissionsCard";

describe("Automation settings", () => {
  it("renders a loader first, never a switched-on state", () => {
    expect(renderToString(createElement(AutomationSettings))).toContain("Loading");
  });
  it("Switch reflects its value", () => {
    expect(renderToString(createElement(Switch, { checked: false, onChange: () => {}, label: "x" }))).toContain('aria-checked="false"');
  });
});

describe("eBay permissions prompt", () => {
  it("hidden when nothing is missing", () => {
    expect(renderToString(createElement(EbayPermissionsView, { missing: [] }))).toBe("");
  });
  it("links to the extended reconnect and reassures", () => {
    const html = renderToString(createElement(EbayPermissionsView, { missing: ["marketing", "analytics"] }));
    expect(html).toContain("/api/ebay/connect?scopes=extended");
    expect(html).toContain("current connection keeps working");
    expect(html).toContain("markdown sales");
  });
});
