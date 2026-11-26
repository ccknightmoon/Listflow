import { describe, it, expect } from "vitest";
import {
  STORE_INTRO_DEFAULT, applyStoreIntro, containsIntroText, descriptionPrefsFrom, finalizeListingDescription,
  introTextToHtml, measurementsSeePhotos, removeIntroFromPlainText, stripStoreIntro,
} from "@/lib/store-intro";
import { buildDescriptionHtml } from "@/lib/item-specifics";

// Sel's intro exactly as he pastes it (trailing space on line 1 included).
const SEL = `Welcome to our store :)! 
Explore unique second-hand treasures with detailed photos!
Each order is carefully packed and shipped fast for quick delivery. 
Questions? Contact support anytime; help is ready! 
Shop quality pre-owned items, including vintage and collectible finds.
Don't miss other great deals! 
Grab yours now and return for more!

Item Condition: Just as seen in the pictures!
See photos for details and measurements for accurate fit.`;

const LINES = SEL.split("\n").map((l) => l.trim()).filter(Boolean);

const template = () => buildDescriptionHtml({
  title: "Nike Hoodie Mens L",
  summary: "Grey pullover hoodie.",
  details: [["Brand", "Nike"]],
  measurements: [{ key: "pitToPit", inches: 22, approx: false }, { key: "length", inches: 28, approx: false }],
  conditionLabel: "Excellent used",
  notes: "Ships next day.",
});

/** Visible text in order, the way the eBay app shows it (tags dropped, <br>/<p> as line breaks). */
const visible = (html: string) =>
  html.replace(/<!--[\s\S]*?-->/g, "").replace(/<br>/g, "\n").replace(/<\/p>|<\/h\d>|<\/li>/g, "\n").replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

describe("introTextToHtml", () => {
  it("keeps every line, blank-line paragraphs and the :) emoticon; escapes HTML", () => {
    const html = introTextToHtml(SEL);
    expect(html).toContain("Grab yours now and return for more!<br><br>Item Condition:"); // blank line kept
    expect(html).toContain("Welcome to our store :)!<br>Explore");
    expect(html).toContain("Don't miss other great deals!");
    expect(introTextToHtml("<b>hi</b> & \"x\"")).toBe('<p style="margin:0">&lt;b&gt;hi&lt;/b&gt; &amp; &quot;x&quot;</p>');
  });
});

describe("applyStoreIntro", () => {
  it("published description starts with the exact intro text and contains every line", () => {
    const out = finalizeListingDescription(template(), { storeIntro: SEL, measurementsSeePhotos: false });
    const text = visible(out).trimStart();
    // The very first content of eBay's Description is the intro, before the title.
    expect(text.startsWith(SEL.split("\n").map((l) => l.trimEnd()).join("\n"))).toBe(true);
    for (const l of LINES) expect(text).toContain(l);
    expect(text).toContain("Grab yours now and return for more!\n\nItem Condition:");
    expect(text.indexOf("Welcome to our store :)!")).toBeLessThan(text.indexOf("Nike Hoodie Mens L"));
    // Shipping & returns stays at the bottom.
    expect(text.indexOf("Shipping & returns")).toBeGreaterThan(text.indexOf("Condition\n"));
    // Still our template (so later builds recognise it) and no raw tags in the text.
    expect(out.startsWith('<div style="font-family:Arial')).toBe(true);
    expect(text).not.toMatch(/<|&lt;/);
  });

  it("is idempotent: re-publishing/revising never adds a second copy", () => {
    const once = applyStoreIntro(template(), SEL);
    const twice = applyStoreIntro(once, SEL);
    expect(twice).toBe(once);
    expect(visible(twice).split("Welcome to our store").length).toBe(2);
  });

  it("replaces an older intro with the current one", () => {
    const old = applyStoreIntro(template(), "Old welcome text");
    const now = applyStoreIntro(old, SEL);
    expect(now).not.toContain("Old welcome text");
    expect(visible(now).trimStart().startsWith("Welcome to our store :)!")).toBe(true);
  });

  it("still recognises our block when eBay drops the comment markers", () => {
    const noComments = applyStoreIntro(template(), SEL).replace(/<!--[\s\S]*?-->/g, "");
    expect(applyStoreIntro(noComments, SEL).split("class=\"lf-store-intro\"").length).toBe(2);
  });

  it("doesn't add it when the text is already there unmarked (pasted by hand)", () => {
    const pasted = `<div><p>${SEL.replace(/\n/g, "<br>")}</p><p>Nice jacket</p></div>`;
    expect(applyStoreIntro(pasted, SEL)).toBe(pasted);
  });

  it("puts it first on an eBay-made description too", () => {
    const out = applyStoreIntro("<p>Nice jacket</p>", SEL);
    expect(visible(out).trimStart().startsWith("Welcome to our store :)!")).toBe(true);
    expect(out.endsWith("<p>Nice jacket</p>")).toBe(true);
  });

  it("off/empty removes a previously added block", () => {
    const on = applyStoreIntro(template(), SEL);
    expect(applyStoreIntro(on, null)).toBe(template());
    expect(stripStoreIntro(on)).toBe(template());
  });

  it("no character cutoff for a long intro", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of the welcome message.`).join("\n");
    const text = visible(applyStoreIntro(template(), long));
    expect(text).toContain("Line 40 of the welcome message.");
  });
});

describe("removeIntroFromPlainText", () => {
  it("drops a hand-pasted copy from a plain description, keeps the rest", () => {
    expect(removeIntroFromPlainText(`${SEL}\n\nGrey pullover hoodie.`, SEL)).toBe("Grey pullover hoodie.");
    expect(removeIntroFromPlainText("Grey pullover hoodie.", SEL)).toBe("Grey pullover hoodie.");
    expect(removeIntroFromPlainText("Grey", null)).toBe("Grey");
  });
});

describe("measurementsSeePhotos", () => {
  it("replaces the AI measurement list with one line", () => {
    const out = measurementsSeePhotos(template());
    expect(out).not.toContain("Pit to pit");
    expect(visible(out)).toContain("Measurements\nSee photos for measurements.");
    expect(measurementsSeePhotos(out)).toBe(out);
  });
  it("leaves the description alone when off", () => {
    expect(finalizeListingDescription(template(), { storeIntro: null, measurementsSeePhotos: false })).toBe(template());
  });
});

describe("descriptionPrefsFrom", () => {
  it("only on when enabled and non-empty; never truncates", () => {
    expect(descriptionPrefsFrom(null)).toEqual({ storeIntro: null, measurementsSeePhotos: false });
    expect(descriptionPrefsFrom({ store_intro_enabled: false, store_intro_text: "Hi" }).storeIntro).toBeNull();
    expect(descriptionPrefsFrom({ store_intro_enabled: true, store_intro_text: "   " }).storeIntro).toBeNull();
    expect(descriptionPrefsFrom({ store_intro_enabled: true, store_intro_text: SEL, measurements_see_photos: true })).toEqual({ storeIntro: SEL.trim(), measurementsSeePhotos: true });
  });
  it("default intro is Sel's text", () => {
    expect(containsIntroText(STORE_INTRO_DEFAULT, SEL)).toBe(true);
  });
});
