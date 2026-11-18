import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Z } from "@/lib/z-layers";

const nav = vi.hoisted(() => ({ path: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useRouter: () => ({ push: () => {} }) }));

import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";
import Sheet from "./Sheet";

const z = (html: string) => Number(html.match(/z-index:(\d+)/)?.[1]);

beforeEach(() => { nav.path = "/dashboard"; });

describe("desktop sidebar vs phone bottom bar", () => {
  it("sidebar is CSS-gated to lg+ and lists every destination with New listing first", () => {
    const html = renderToString(createElement(Sidebar));
    expect(html).toContain("hidden lg:flex");
    expect(html).toContain("New listing");
    for (const l of ["Home", "Listings", "Sales", "Drafts", "Messages", "Offers", "Ship", "Settings"]) expect(html).toContain(l);
    expect(html.indexOf("New listing")).toBeLessThan(html.indexOf("Home"));
    expect(html).toMatch(/aria-current="page"[^>]*href="\/dashboard"|href="\/dashboard"[^>]*aria-current="page"/);
  });

  it("sidebar marks a sub-route's section active (draft editor → Drafts)", () => {
    nav.path = "/drafts/abc";
    const html = renderToString(createElement(Sidebar));
    expect(html).toMatch(/aria-current="page"[^>]*href="\/drafts"|href="\/drafts"[^>]*aria-current="page"/);
    expect(html).not.toMatch(/aria-current="page"[^>]*href="\/dashboard"/);
  });

  it("sidebar is absent on signed-out screens", () => {
    for (const p of ["/login", "/", "/reset-password"]) {
      nav.path = p;
      expect(renderToString(createElement(Sidebar))).toBe("");
    }
  });

  it("sidebar sits on the nav layer: below sheets, confirms and toasts", () => {
    const html = renderToString(createElement(Sidebar));
    expect(z(html)).toBe(Z.nav);
    expect(Z.sheet).toBeGreaterThan(Z.nav);
  });

  it("bottom bar is hidden from lg up (phones unchanged)", () => {
    const html = renderToString(createElement(BottomNav));
    expect(html).toContain("lg:hidden fixed");
    expect(html).toContain("grid-cols-5");
  });
});

describe("sheets on desktop", () => {
  it("default: bottom sheet on phones, centred modal from lg", () => {
    const html = renderToString(createElement(Sheet, { open: true, onClose: () => {}, title: "T" }, "x"));
    expect(html).toContain("items-end justify-center");
    expect(html).toContain("lg:items-center");
    expect(html).toContain("lg:max-w-lg");
    expect(z(html)).toBe(Z.sheet);
  });
  it("drawer: full-height panel on the right from lg", () => {
    const html = renderToString(createElement(Sheet, { open: true, onClose: () => {}, title: "T", desktop: "drawer" }, "x"));
    expect(html).toContain("lg:justify-end");
    expect(html).toContain("lg:h-full");
    expect(html).toContain('data-desktop="drawer"');
  });
});
