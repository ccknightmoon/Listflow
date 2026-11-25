import { describe, it, expect } from "vitest";
import { addTombstones, pruneTombstones, withoutDeleted } from "@/lib/deleted-drafts";

describe("deleted-draft markers", () => {
  it("a deleted draft never shows from a saved copy", () => {
    const t = addTombstones({}, ["b"], 1000);
    expect(withoutDeleted([{ id: "a" }, { id: "b" }, { id: "c" }], t).map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("forgets markers after 30 days", () => {
    const t = addTombstones({}, ["old"], 0);
    expect(pruneTombstones(t, 31 * 86_400_000)).toEqual({});
    expect(pruneTombstones(t, 29 * 86_400_000)).toEqual({ old: 0 });
  });

  it("adding keeps recent markers", () => {
    const t = addTombstones(addTombstones({}, ["a"], 1000), ["b"], 2000);
    expect(Object.keys(t).sort()).toEqual(["a", "b"]);
  });
});
