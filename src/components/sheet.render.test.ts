import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Z } from "@/lib/z-layers";

vi.mock("next/navigation", () => ({ usePathname: () => "/store", useRouter: () => ({ push: () => {} }) }));
import Sheet from "./Sheet";
import PriceSheet from "./PriceSheet";

const z = (html: string) => Number(html.match(/z-index:(\d+)/)?.[1]);

describe("sheets render above the nav", () => {
  it("Sheet uses the sheet layer, above nav and tray, with a backdrop and a pinned footer", () => {
    const html = renderToString(createElement(Sheet, { open: true, onClose: () => {}, title: "T", footer: createElement("button", null, "Apply") }, "body"));
    expect(z(html)).toBe(Z.sheet);
    expect(z(html)).toBeGreaterThan(Z.nav);
    expect(z(html)).toBeGreaterThan(Z.tray);
    expect(html).toContain('aria-label="Close"'); // backdrop button blocks taps behind
    expect(html).toContain("90dvh");
    expect(html).toContain("safe-area-inset-bottom");
    expect(html.indexOf("body")).toBeLessThan(html.indexOf("Apply")); // footer after scroll area
  });
  it("confirm layer sits above sheets", () => {
    const html = renderToString(createElement(Sheet, { open: true, onClose: () => {}, layer: "confirm", title: "Sure?" }));
    expect(z(html)).toBe(Z.confirm);
  });
  it("PriceSheet's apply button is in the pinned footer", () => {
    const html = renderToString(createElement(PriceSheet, { open: true, items: [{ id: "1", title: "Tee", price: 44.99 }], onClose: () => {}, onApply: () => {} })).replace(/<!-- -->/g, "");
    const footerStart = html.lastIndexOf("border-top");
    expect(html.indexOf("Lower to $38.24")).toBeGreaterThan(footerStart);
  });
});

describe("no stray z-index numbers", () => {
  it("overlays/fixed elements use the Z scale (no z-40/z-50/z-[60] classes left)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(f) && !/\.test\./.test(f)) {
          const src = readFileSync(p, "utf8");
          if (/\bz-(40|50|\[\d+\])/.test(src)) offenders.push(p);
        }
      }
    };
    walk(path.join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});
