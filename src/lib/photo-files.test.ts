import { describe, it, expect } from "vitest";
import { imageFilesFrom, isImage, dragHasFiles, shouldHandlePaste } from "./photo-files";

const file = (type: string, name = "x") => ({ type, name }) as unknown as File;

describe("desktop photo input", () => {
  it("keeps only images from a drop, including extension-only files", () => {
    const out = imageFilesFrom({ files: [file("image/jpeg"), file("application/pdf"), file("", "IMG_1.HEIC")] });
    expect(out).toHaveLength(2);
  });
  it("reads pasted screenshots from clipboard items", () => {
    const shot = file("image/png");
    const out = imageFilesFrom({ files: [], items: [{ kind: "string", type: "text/plain", getAsFile: () => null }, { kind: "file", type: "image/png", getAsFile: () => shot }] });
    expect(out).toEqual([shot]);
  });
  it("handles empty / missing transfers", () => {
    expect(imageFilesFrom(null)).toEqual([]);
    expect(imageFilesFrom({})).toEqual([]);
  });
  it("detects file drags only", () => {
    expect(dragHasFiles({ types: ["Files"] })).toBe(true);
    expect(dragHasFiles({ types: ["text/plain"] })).toBe(false);
    expect(isImage(file("image/webp"))).toBe(true);
  });
  it("doesn't steal text pastes from inputs", () => {
    expect(shouldHandlePaste("INPUT", false, 1, true)).toBe(false);
    expect(shouldHandlePaste("INPUT", false, 1, false)).toBe(true);
    expect(shouldHandlePaste("BODY", false, 2, true)).toBe(true);
    expect(shouldHandlePaste("BODY", false, 0, false)).toBe(false);
  });
});
