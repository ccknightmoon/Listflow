import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import DataTable from "./DataTable";
import { RowMenu } from "./RowMenu";
import { Z } from "@/lib/z-layers";

type Row = { id: string; title: string; price: number };
const rows: Row[] = [{ id: "1", title: "Nike tee", price: 20 }, { id: "2", title: "Levi jeans", price: 35 }, { id: "3", title: "Coach bag", price: 80 }];

const table = (selected: string[] = []) =>
  renderToString(createElement(DataTable<Row>, {
    caption: "Listings",
    rows,
    rowId: (r) => r.id,
    rowLabel: (r) => r.title,
    columns: [{ id: "t", header: "Item", cell: (r) => r.title }, { id: "p", header: "Price", cell: (r) => `$${r.price}` }],
    selected: new Set(selected),
    onSelectionChange: () => {},
    menuActions: () => [{ label: "End listing", tone: "danger" as const, onAction: () => {} }],
    quickActions: () => [{ label: "Price", onAction: () => {} }],
  })).replace(/<!-- -->/g, "");

describe("desktop table (Listings / Drafts)", () => {
  it("has a select-all checkbox and one checkbox per row", () => {
    const html = table();
    expect(html).toContain('aria-label="Select all rows"');
    for (const r of rows) expect(html).toContain(`aria-label="Select ${r.title}"`);
  });
  it("uses a roving tabindex: one row in the Tab order", () => {
    const html = table();
    expect((html.match(/<tr[^>]*data-row[^>]*tabindex="0"/g) ?? []).length + (html.match(/<tr[^>]*tabindex="0"[^>]*data-row/g) ?? []).length).toBe(1);
    expect((html.match(/tabindex="-1"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("marks selected rows and the header checkbox", () => {
    const html = table(["1", "2", "3"]);
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(3);
    expect(html).toContain('aria-label="Unselect all rows"');
  });
  it("shows hover actions and a labelled ⋯ menu button on every row", () => {
    const html = table();
    expect((html.match(/class="hover-actions/g) ?? []).length).toBe(3);
    expect(html).toContain('aria-label="More actions for Coach bag"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain("Shift+F10"); // keyboard help in the caption
  });
});

describe("row menu", () => {
  it("is a proper menu on the menu layer, above the tray and below sheets", () => {
    const html = renderToString(createElement(RowMenu, { at: { x: 10, y: 10 }, onClose: () => {}, actions: [{ label: "View on eBay", href: "https://ebay.com/itm/1", external: true }, { label: "End listing", tone: "danger", onAction: () => {} }] }));
    expect(html).toContain('role="menu"');
    expect((html.match(/role="menuitem"/g) ?? []).length).toBe(2);
    expect(html).toContain('target="_blank"');
    expect(Number(html.match(/z-index:(\d+)/)?.[1])).toBe(Z.menu);
    expect(Z.menu).toBeGreaterThan(Z.tray);
    expect(Z.menu).toBeLessThan(Z.sheet);
  });
  it("renders nothing when closed", () => {
    expect(renderToString(createElement(RowMenu, { at: null, onClose: () => {}, actions: [] }))).toBe("");
  });
});
