import { describe, expect, it } from "vitest";
import {
  STORAGE_DEFAULTS, UNASSIGNED, boxErrors, boxForSku, compareSku, generateBoxes, groupPickList, locationFor,
  normalizeLocation, parseStorageBody, showsLocationField, skuNumber, sortPickList, storageFromRow, type StorageSettings,
} from "./storage-locations";

const boxes = [{ name: "Box 17", from: 1601, to: 1700 }, { name: "Box 18", from: 1701, to: 1800 }];
const on = (mode: StorageSettings["mode"]): StorageSettings => ({ enabled: true, mode, boxes });

describe("off by default", () => {
  it("defaults, missing column and junk all mean OFF with no location", () => {
    expect(STORAGE_DEFAULTS.enabled).toBe(false);
    for (const raw of [null, undefined, "x", 5, {}, { enabled: "true" }]) {
      const s = storageFromRow(raw);
      expect(s.enabled).toBe(false);
      expect(locationFor({ sku: "1740", location: "B3" }, s)).toBeNull();
      expect(showsLocationField(s)).toBe(false);
    }
    expect(showsLocationField(null)).toBe(false);
  });
  it("off sorts To-ship by SKU (numeric-aware)", () => {
    const rows = [{ key: "a", sku: "1740", title: "x", location: null }, { key: "b", sku: "100", title: "y", location: null }, { key: "c", sku: "99", title: "z", location: null }];
    expect(sortPickList(rows, STORAGE_DEFAULTS).map((r) => r.sku)).toEqual(["99", "100", "1740"]);
    expect(groupPickList(rows, STORAGE_DEFAULTS)).toHaveLength(1);
  });
});

describe("SKU numbers", () => {
  it("numeric compare: 99 < 100 < 1740, then text SKUs, empty last", () => {
    expect(["1740", "", "A12", "100", "99", "A2", "0099"].sort(compareSku)).toEqual(["0099", "99", "100", "1740", "A2", "A12", ""]);
    expect(skuNumber(" 001740 ")).toBe(1740);
    expect(skuNumber("HD1740")).toBeNull();
    expect(skuNumber("12.5")).toBeNull();
  });
});

describe("SKU boxes", () => {
  it("range lookup, edges included; non-numeric or uncovered = Unassigned", () => {
    expect(boxForSku("1701", boxes)).toBe("Box 18");
    expect(boxForSku("1800", boxes)).toBe("Box 18");
    expect(boxForSku("1700", boxes)).toBe("Box 17");
    expect(boxForSku("1801", boxes)).toBeNull();
    expect(locationFor({ sku: "1740" }, on("sku_boxes"))).toBe("Box 18");
    expect(locationFor({ sku: "HD-9" }, on("sku_boxes"))).toBe(UNASSIGNED);
    expect(locationFor({ sku: null }, on("sku_boxes"))).toBe(UNASSIGNED);
    expect(locationFor({ sku: "1740", location: "RACK A" }, on("sku_boxes"))).toBe("Box 18"); // typed text ignored
  });
  it("overlaps, bad ranges, names", () => {
    expect(boxErrors(boxes)).toEqual([]);
    expect(boxErrors([...boxes, { name: "Box X", from: 1750, to: 1900 }]).join(" ")).toMatch(/Box 18 and Box X overlap \(SKU 1750–1800\)/);
    expect(boxErrors([{ name: "A", from: 10, to: 10 }, { name: "B", from: 10, to: 20 }])[0]).toMatch(/overlap/);
    expect(boxErrors([{ name: "", from: 1, to: 2 }])[0]).toMatch(/name/);
    expect(boxErrors([{ name: "A", from: 5, to: 2 }])[0]).toMatch(/bigger/);
    expect(boxErrors([{ name: "A", from: 1.5, to: 2 }])[0]).toMatch(/whole/);
    expect(boxErrors([{ name: "A", from: 1, to: 2 }, { name: "a", from: 3, to: 4 }])[0]).toMatch(/used 2 times/);
  });
  it("generate boxes", () => {
    expect(generateBoxes({ startSku: 1601, perBox: 100, count: 2, prefix: "Box", firstNumber: 17 })).toEqual(boxes);
    expect(boxErrors(generateBoxes({ startSku: 1, perBox: 50, count: 40, prefix: "Shelf" }))).toEqual([]);
    expect(generateBoxes({ startSku: 1, perBox: 0, count: 3, prefix: "Box" })).toEqual([]);
  });
  it("pick list sorts by box, then SKU; Unassigned last", () => {
    const rows = [
      { key: "1", sku: "1790", title: "a", location: "Box 18" },
      { key: "2", sku: "X1", title: "b", location: UNASSIGNED },
      { key: "3", sku: "1650", title: "c", location: "Box 17" },
      { key: "4", sku: "1705", title: "d", location: "Box 18" },
    ];
    expect(sortPickList(rows, on("sku_boxes")).map((r) => r.key)).toEqual(["3", "4", "1", "2"]);
    expect(groupPickList(rows, on("sku_boxes")).map((g) => [g.location, g.rows.length])).toEqual([["Box 17", 1], ["Box 18", 2], [UNASSIGNED, 1]]);
  });
});

describe("bins / racks and SKU only", () => {
  it("bins: typed location, sorted by location then SKU", () => {
    expect(showsLocationField(on("bins"))).toBe(true);
    expect(locationFor({ sku: "5", location: " RACK B " }, on("bins"))).toBe("RACK B");
    const rows = [{ key: "1", sku: "20", title: "a", location: "RACK B" }, { key: "2", sku: "3", title: "b", location: null }, { key: "3", sku: "10", title: "c", location: "RACK A" }, { key: "4", sku: "9", title: "d", location: "RACK B" }];
    expect(sortPickList(rows, on("bins")).map((r) => r.key)).toEqual(["3", "4", "1", "2"]);
  });
  it("SKU only: no location, SKU order", () => {
    expect(locationFor({ sku: "1740", location: "B3" }, on("sku_only"))).toBeNull();
    expect(showsLocationField(on("sku_only"))).toBe(false);
  });
  it("normalizes typed locations", () => {
    expect(normalizeLocation(" b3 ")).toBe("B3");
    expect(normalizeLocation("")).toBeNull();
    expect(normalizeLocation("x".repeat(25))).toBeUndefined();
  });
});

describe("settings body", () => {
  it("validates and rejects overlaps", () => {
    expect(parseStorageBody({ enabled: true, mode: "sku_boxes", boxes })).toEqual({ value: on("sku_boxes") });
    expect(parseStorageBody({ enabled: true, mode: "sku_boxes", boxes: [...boxes, { name: "Box Z", from: 1800, to: 1810 }] })).toHaveProperty("error");
    expect(parseStorageBody({ enabled: "yes", mode: "bins", boxes: [] })).toHaveProperty("error");
    expect(parseStorageBody({ enabled: false, mode: "nope", boxes: [] })).toHaveProperty("error");
    // switching mode keeps a valid box list for later
    expect(parseStorageBody({ enabled: true, mode: "bins", boxes })).toEqual({ value: { enabled: true, mode: "bins", boxes } });
  });
});
