import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import BulkEditSheet from "./BulkEditSheet";

describe("BulkEditSheet", () => {
  const items = [{ id: "a", title: "Nike Tee", price: 20, condition: "Excellent used" }];
  it("shows only the allowed fields", () => {
    const listings = renderToString(createElement(BulkEditSheet, { open: true, items, fields: ["price"], onClose: () => {}, onApply: async () => null }));
    expect(listings).toContain("Set to $");
    expect(listings).not.toContain("Title words");
    const drafts = renderToString(createElement(BulkEditSheet, { open: true, items, fields: ["price", "condition", "category", "title"], onClose: () => {}, onApply: async () => null }));
    for (const t of ["Price", "Condition", "Store category", "Title words", "Edit <!-- -->1<!-- --> item"]) expect(drafts).toContain(t);
  });
  it("renders nothing when closed", () => {
    expect(renderToString(createElement(BulkEditSheet, { open: false, items, fields: ["price"], onClose: () => {}, onApply: async () => null }))).toBe("");
  });
});
