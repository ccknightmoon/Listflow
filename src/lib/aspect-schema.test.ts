import { describe, it, expect } from "vitest";
import { buildAspectSchema, parseSchemaAnswer, MAX_SCHEMA_PROPERTIES } from "./aspect-schema";
import type { AspectDef } from "./item-specifics";

const def = (name: string, o: Partial<AspectDef> = {}): AspectDef => ({ name, required: false, recommended: true, mode: "FREE_TEXT", multi: false, values: [], ...o });

describe("Pass B schema from the category's aspects", () => {
  const defs = [
    def("Season", { mode: "SELECTION_ONLY", multi: true, values: ["Fall", "Winter", "Spring", "Summer"] }),
    def("Team", { required: true, mode: "SELECTION_ONLY", values: ["Pittsburgh Steelers", "Dallas Cowboys"] }),
    def("Brand", { required: true, values: Array.from({ length: 3000 }, (_, i) => `B${i}`) }),
    def("Country/Region of Manufacture", { mode: "SELECTION_ONLY", values: Array.from({ length: 300 }, (_, i) => `C${i}`) }),
  ];
  const s = buildAspectSchema(defs);
  const props = (s.schema as { properties: Record<string, { anyOf: Array<Record<string, unknown>> }> }).properties;
  it("required first; every field required-but-nullable; no extra fields allowed", () => {
    expect(s.keys.map((k) => k.def.name)).toEqual(["Team", "Brand", "Season", "Country/Region of Manufacture"]);
    expect((s.schema as { required: string[] }).required).toHaveLength(4);
    expect((s.schema as { additionalProperties: boolean }).additionalProperties).toBe(false);
    for (const p of Object.values(props)) expect(p.anyOf.some((x) => x.type === "null")).toBe(true);
  });
  it("selection-only values are enums; multi-value is an array; huge lists fall back to strings", () => {
    const team = props[s.keys[0].key].anyOf[0] as { enum?: string[] };
    expect(team.enum).toEqual(["Pittsburgh Steelers", "Dallas Cowboys"]);
    const season = props[s.keys[2].key].anyOf[0] as { type: string; items: { enum: string[] } };
    expect(season.type).toBe("array");
    expect(season.items.enum).toContain("Winter");
    expect(s.keys[1].enumerated).toBe(false); // Brand: free text, 3000 values
    expect(s.keys[3].enumerated).toBe(false); // 300 > per-aspect enum cap
  });
  it("caps the number of properties", () => {
    expect(buildAspectSchema(Array.from({ length: 200 }, (_, i) => def(`A${i}`))).keys).toHaveLength(MAX_SCHEMA_PROPERTIES);
  });
  it("parses answers: nulls/blank dropped, single-value gets one", () => {
    const k = Object.fromEntries(s.keys.map((x) => [x.def.name, x.key]));
    const a = parseSchemaAnswer({ [k.Team]: "Pittsburgh Steelers", [k.Brand]: null, [k.Season]: ["Fall", "Winter", "Fall"], [k["Country/Region of Manufacture"]]: "unknown" }, s);
    expect(a).toEqual({ Team: ["Pittsburgh Steelers"], Season: ["Fall", "Winter"] });
    expect(parseSchemaAnswer(null, s)).toEqual({});
  });
});
