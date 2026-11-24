import { describe, it, expect } from "vitest";
import { buildServiceWorker } from "@/lib/sw-source";

describe("service worker source", () => {
  it("bakes in a sanitized version and never touches /api", () => {
    const src = buildServiceWorker('abc123"; evil()');
    expect(src).toContain('const VERSION = "abc123evil"');
    expect(src).toContain('url.pathname.startsWith("/api/")');
    expect(() => new Function(src.replace(/self\./g, "globalThis.__s.").replace(/self\b/g, "globalThis.__s"))).not.toThrow();
  });
});
