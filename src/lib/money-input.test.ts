import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { sanitizeMoneyInput } from "./money-input";
import CurrencyInput from "@/components/CurrencyInput";

describe("sanitizeMoneyInput", () => {
  it.each([
    ["12.345", "12.34"], ["$1,299.5", "1299.5"], ["abc", ""], ["1.2.3", "1.23"], [".5", ".5"], ["07", "07"],
  ])("%s → %s", (raw, out) => expect(sanitizeMoneyInput(raw)).toBe(out));
  it("handles negatives only when allowed", () => {
    expect(sanitizeMoneyInput("-5")).toBe("5");
    expect(sanitizeMoneyInput("--3.5", { allowNegative: true })).toBe("-3.5");
    expect(sanitizeMoneyInput("5-", { allowNegative: true })).toBe("5");
    expect(sanitizeMoneyInput("12.3456", { maxDecimals: 3 })).toBe("12.345");
  });
});

describe("CurrencyInput", () => {
  it("reserves room for the $ with inline padding and keeps the decimal keypad", () => {
    const html = renderToString(createElement(CurrencyInput, { value: "12.50", onChange: () => {}, "aria-label": "What you paid" }));
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('type="text"');
    expect(html).toMatch(/padding-left:2\dpx/);
    expect(html).toContain(">$</span>");
  });
  it("supports a % suffix with no prefix", () => {
    const html = renderToString(createElement(CurrencyInput, { value: "10", onChange: () => {}, prefix: null, suffix: "%" }));
    expect(html).not.toContain(">$<");
    expect(html).toMatch(/padding-right:\d+px/);
  });
});
