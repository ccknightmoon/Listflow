import { afterEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ model: string }> = [];
let answers: Array<Record<string, unknown>> = [];
vi.mock("@/lib/openai-request", () => ({
  openAIPost: async (_key: string, body: { model: string }) => {
    calls.push({ model: body.model });
    const a = answers.shift() ?? {};
    return { choices: [{ message: { content: JSON.stringify(a) } }] };
  },
}));

import { analyzeGroupSmart, hardItemReasons } from "./analyze-core";
import { escalationModel } from "./ai-models";

const imgs = [{ data: "a" }, { data: "b" }];
const easy = { brand: "Nike", tag: { brand: "Nike", size: "L" } };
const hard = { brand: "Nike", tag: { brand: "", size: "" } };

afterEach(() => { calls.length = 0; answers = []; vi.unstubAllEnvs(); });

describe("hard-item escalation", () => {
  it("is off by default: one vision call", async () => {
    answers = [hard];
    const t: Record<string, number> = {};
    await analyzeGroupSmart("k", imgs, t);
    expect(calls.map((c) => c.model)).toEqual(["gpt-4o-mini"]);
    expect(t.escalated).toBeUndefined();
  });
  it("re-reads hard items with the stronger model when AI_ESCALATION_MODEL is set", async () => {
    vi.stubEnv("AI_ESCALATION_MODEL", "gpt-4o");
    answers = [hard, { brand: "Nike", tag: { brand: "Nike", size: "M" } }];
    const t: Record<string, number> = {};
    const r = await analyzeGroupSmart("k", imgs, t);
    expect(calls.map((c) => c.model)).toEqual(["gpt-4o-mini", "gpt-4o"]);
    expect(r.tag.size).toBe("M");
    expect(t.escalated).toBe(1);
  });
  it("skips easy items and single photos", async () => {
    vi.stubEnv("AI_ESCALATION_MODEL", "gpt-4o");
    answers = [easy];
    await analyzeGroupSmart("k", imgs, {});
    answers = [hard];
    await analyzeGroupSmart("k", [{ data: "a" }], {});
    expect(calls.map((c) => c.model)).toEqual(["gpt-4o-mini", "gpt-4o-mini"]);
  });
  it("reasons + model guard", () => {
    expect(hardItemReasons(easy)).toEqual([]);
    expect(hardItemReasons({ brand: "Unbranded", tag: { size: "L" } })).toEqual([]);
    expect(hardItemReasons({ ...easy, era: "90s" })).toEqual(["vintage"]);
    expect(escalationModel({})).toBeNull();
    expect(escalationModel({ AI_ESCALATION_MODEL: "gpt-4o-mini" })).toBeNull();
    expect(escalationModel({ AI_ESCALATION_MODEL: "bad model!" })).toBeNull();
    expect(escalationModel({ AI_ESCALATION_MODEL: "gpt-4o" })).toBe("gpt-4o");
  });
});
