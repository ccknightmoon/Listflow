import { describe, it, expect } from "vitest";
import { rankOptions, offerCustom, windowRange, toggleValue } from "./combobox";

const TEAMS = ["Arizona Cardinals", "Pittsburgh Steelers", "Pittsburgh Pirates", "Steel City FC", "Dallas Cowboys"];

describe("combobox helpers", () => {
  it("ranks exact, starts-with, word-start, contains", () => {
    expect(rankOptions(TEAMS, "pitts")).toEqual(["Pittsburgh Steelers", "Pittsburgh Pirates"]);
    expect(rankOptions(TEAMS, "steel")).toEqual(["Steel City FC", "Pittsburgh Steelers"]);
    expect(rankOptions(TEAMS, "pitt steel")).toEqual(["Pittsburgh Steelers"]);
    expect(rankOptions(TEAMS, "")).toEqual(TEAMS);
    expect(rankOptions(Array.from({ length: 5000 }, (_, i) => `Brand ${i}`), "brand", 100)).toHaveLength(100);
  });
  it("offers a custom value only for free text that isn't listed", () => {
    expect(offerCustom("Hanes Beefy", ["Hanes"], true)).toBe(true);
    expect(offerCustom("hanes", ["Hanes"], true)).toBe(false);
    expect(offerCustom("Hanes Beefy", ["Hanes"], false)).toBe(false);
    expect(offerCustom("  ", ["Hanes"], true)).toBe(false);
  });
  it("virtualizes long lists", () => {
    expect(windowRange(0, 44, 352, 5000)).toEqual({ start: 0, end: 14 });
    expect(windowRange(44 * 1000, 44, 352, 5000)).toEqual({ start: 994, end: 1014 });
    expect(windowRange(44 * 4998, 44, 352, 5000).end).toBe(5000);
  });
  it("toggles multi-select values", () => {
    expect(toggleValue(["Pockets"], "Hood")).toEqual(["Pockets", "Hood"]);
    expect(toggleValue(["Pockets", "Hood"], "pockets")).toEqual(["Hood"]);
  });
});
