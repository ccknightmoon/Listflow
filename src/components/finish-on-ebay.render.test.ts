import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FINISH_SCHEDULE_DAYS, DRAFTS_TAB_NOTE, FINISH_STEPS } from "@/lib/finish-on-ebay";

vi.mock("@/components/Sheet", () => ({
  default: ({ open, children, footer, title }: { open: boolean; children: unknown; footer: unknown; title: string }) =>
    open ? createElement("div", { "data-sheet": title }, children as never, footer as never) : null,
}));
import FinishOnEbaySheet from "./FinishOnEbaySheet";

describe("Finish on eBay explainer", () => {
  it("schedules 3 weeks out and explains the eBay Drafts tab restriction", () => {
    expect(FINISH_SCHEDULE_DAYS).toBe(21);
    expect(DRAFTS_TAB_NOTE).toMatch(/Drafts tab/);
    expect(DRAFTS_TAB_NOTE).toMatch(/doesn't let outside apps/);
    expect(FINISH_STEPS.join(" ")).toMatch(/Selling → Scheduled/);
  });
  it("renders the steps and the send button only when open", () => {
    const html = renderToString(createElement(FinishOnEbaySheet, { open: true, onClose: () => {}, onConfirm: () => {} }));
    expect(html).toContain("Send to the eBay app");
    expect(html).toContain("List it now");
    expect(html).toContain("Drafts tab");
    expect(renderToString(createElement(FinishOnEbaySheet, { open: false, onClose: () => {}, onConfirm: () => {} }))).toBe("");
  });
});
