import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import StoreIntroHint, { StoreIntroHintView } from "./StoreIntroHint";

describe("StoreIntroHint", () => {
  it("shows only the small line on cards, not the intro text", () => {
    const html = renderToString(createElement(StoreIntroHintView, { text: "Welcome to our store :)!" }));
    expect(html).toContain("+ Store intro will be added when listed");
    expect(html).not.toContain("Welcome to our store");
    expect(html).toContain('aria-expanded="false"');
  });
  it("renders nothing until settings say it's on", () => {
    expect(renderToString(createElement(StoreIntroHint))).toBe("");
  });
});
