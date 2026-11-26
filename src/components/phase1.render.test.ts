import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import DraftExtrasFields from "./DraftExtrasFields";
import HaulsPanel, { salesToHaulSales } from "./business/HaulsPanel";

describe("DraftExtrasFields", () => {
  it("is hidden until the database has the columns", () => {
    expect(renderToString(createElement(DraftExtrasFields, { draftId: "d", bin: undefined, autoOfferOptIn: undefined }))).toBe("");
  });
  it("storage location is OFF by default even when the column exists", () => {
    expect(renderToString(createElement(DraftExtrasFields, { draftId: "d", bin: "B3", autoOfferOptIn: undefined }))).toBe("");
    const html = renderToString(createElement(DraftExtrasFields, { draftId: "d", bin: "B3", autoOfferOptIn: false }));
    expect(html).not.toContain("Storage location");
    expect(html).toContain("Include in automatic offers");
    expect(html).not.toContain("checked");
  });
  it("Bins / racks mode shows the typed field, renamed", () => {
    const html = renderToString(createElement(DraftExtrasFields, { draftId: "d", bin: "RACK B", autoOfferOptIn: undefined, showLocation: true }));
    expect(html).toContain("Storage location");
    expect(html).toContain('value="RACK B"');
    expect(html).not.toMatch(/Bin \/ shelf/);
  });
  it("SKU boxes mode shows the box from the SKU, read-only", () => {
    const html = renderToString(createElement(DraftExtrasFields, { draftId: "d", bin: null, autoOfferOptIn: undefined, derivedLocation: "Box 18" }));
    expect(html).toContain("Box 18");
    expect(html).not.toContain("<input");
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

import { StorageSettingsView } from "./StorageSettings";
import { STORAGE_DEFAULTS } from "@/lib/storage-locations";

describe("Storage & pick list settings", () => {
  const save = async () => null;
  it("off by default: switch off, no modes shown, SKU sort explained", () => {
    const html = renderToString(createElement(StorageSettingsView, { initial: STORAGE_DEFAULTS, available: true, onSave: save }));
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("To-ship sorted by SKU");
    expect(html).not.toContain("SKU boxes");
  });
  it("on in SKU boxes mode: box rows + generate helper", () => {
    const html = renderToString(createElement(StorageSettingsView, { initial: { enabled: true, mode: "sku_boxes", boxes: [{ name: "Box 18", from: 1701, to: 1800 }] }, available: true, onSave: save }));
    expect(html).toContain('value="Box 18"');
    expect(html).toContain("Generate boxes");
    expect(html).toContain("Unassigned");
  });
  it("missing column: explains, stays off", () => {
    expect(renderToString(createElement(StorageSettingsView, { initial: STORAGE_DEFAULTS, available: false, onSave: save }))).toContain("migration 041");
  });
});
