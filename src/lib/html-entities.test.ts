import { describe, it, expect } from "vitest";
import { decodeEntities } from "./html-entities";

describe("decodeEntities", () => {
  it("decodes the titles eBay sends", () => {
    expect(decodeEntities("Levi Strauss &amp; Co Men&#39;s Black")).toBe("Levi Strauss & Co Men's Black");
    expect(decodeEntities("A &amp;amp; B")).toBe("A & B");
    expect(decodeEntities("&quot;90s&quot; &lt;tee&gt; &#x2014; ok")).toBe('"90s" <tee> — ok');
  });
  it("leaves plain text and unknown entities alone", () => {
    expect(decodeEntities("Tom & Jerry")).toBe("Tom & Jerry");
    expect(decodeEntities("&bogus; x")).toBe("&bogus; x");
    expect(decodeEntities(null)).toBe("");
  });
});
