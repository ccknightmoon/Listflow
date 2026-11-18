import { describe, it, expect, vi, beforeEach } from "vitest";

const { ai } = vi.hoisted(() => ({ ai: vi.fn() }));
vi.mock("@/lib/openai-request", () => ({ openAIPost: (...a: unknown[]) => ai(...a) }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ user: { id: "u1" }, supabase: {}, unauthorized: null }) }));
vi.mock("@/lib/ai-usage", () => ({ checkAndConsumeAiUsage: async () => ({ allowed: true }), AI_USAGE_LIMIT_MESSAGE: "limit" }));

import { POST } from "@/app/api/group-photos/route";

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const reply = (obj: unknown) => ({ choices: [{ message: { content: typeof obj === "string" ? obj : JSON.stringify(obj) } }] });
const req = (n: number) =>
  new Request("http://x", { method: "POST", body: JSON.stringify({ images: Array.from({ length: n }, () => ({ data: "AAAA", mediaType: "image/jpeg" })) }) }) as never;

beforeEach(() => {
  ai.mockReset();
  process.env.OPENAI_API_KEY = "test";
});

describe("POST /api/group-photos", () => {
  it("returns a perfect answer as-is (one AI call, structured output)", async () => {
    ai.mockResolvedValueOnce(reply({ groups: [range(0, 9), range(10, 27)] }));
    const data = await (await POST(req(28))).json();
    expect(data.groups).toEqual([range(0, 9), range(10, 27)]);
    expect(ai).toHaveBeenCalledTimes(1);
    expect((ai.mock.calls[0][1] as { response_format: { type: string } }).response_format.type).toBe("json_schema");
  });

  it("Sel's batch: photo 9 missing → one strict per-photo retry fixes it", async () => {
    ai.mockResolvedValueOnce(reply({ groups: [range(0, 8), range(10, 27)] }));
    ai.mockResolvedValueOnce(reply({ photos: range(0, 27).map((i) => ({ index: i, startsNewItem: i === 0 || i === 10 })) }));
    const res = await POST(req(28));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.groups).toEqual([range(0, 9), range(10, 27)]);
    expect(data.retried).toBe(true);
    expect(ai).toHaveBeenCalledTimes(2);
  });

  it("if the retry is unusable too, repairs instead of failing the batch", async () => {
    ai.mockResolvedValueOnce(reply({ groups: [range(0, 8), range(10, 27)] }));
    ai.mockResolvedValueOnce(reply("not json"));
    const res = await POST(req(28));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.groups).toEqual([range(0, 9), range(10, 27)]);
    expect(data.repairs.autoPlaced).toEqual([{ photo: 9, group: 0 }]);
  });

  it("an empty first answer and an empty retry still return every photo (one item, flagged)", async () => {
    ai.mockResolvedValueOnce(reply({ groups: [] }));
    ai.mockResolvedValueOnce(reply({ photos: [] }));
    const data = await (await POST(req(4))).json();
    expect(data.groups).toEqual([[0, 1, 2, 3]]);
    expect(data.repairs.unusable).toBe(true);
  });

  it("duplicates and out-of-range indices are cleaned up", async () => {
    ai.mockResolvedValueOnce(reply({ groups: [[0, 1, 2], [2, 3, 9]] }));
    ai.mockResolvedValueOnce(reply("{"));
    const data = await (await POST(req(4))).json();
    expect(data.groups).toEqual([[0, 1, 2], [3]]);
    expect(data.repairs.duplicatesRemoved).toEqual([2]);
  });
});
