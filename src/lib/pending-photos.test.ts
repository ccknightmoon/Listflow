import { describe, it, expect } from "vitest";
import { setPendingPhotos, takePendingPhotos } from "./pending-photos";

const file = (name: string) => new File(["x"], name, { type: "image/jpeg" });

describe("pending photos hand-off", () => {
  it("delivers once, to the right page", () => {
    setPendingPhotos("single", [file("a.jpg")]);
    setPendingPhotos("batch", [file("b.jpg"), file("c.jpg")]);
    expect(takePendingPhotos("single").map((f) => f.name)).toEqual(["a.jpg"]);
    expect(takePendingPhotos("single")).toEqual([]);
    expect(takePendingPhotos("batch")).toHaveLength(2);
  });
});
