// End to end with mocked AI (OpenAI) and eBay: photos -> background group
// job -> analyze jobs (real Pass A/B enrichment code) -> drafts with Ready
// status -> "List all Ready" publish jobs -> listed. Also crash/retry cases:
// nothing is analyzed, drafted or published twice.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { passBAnswer } from "@/test/pass-b";

const { ai } = vi.hoisted(() => ({ ai: vi.fn() }));
vi.mock("@/lib/openai-request", () => ({ openAIPost: (...a: unknown[]) => ai(...a) }));

const TEES = { id: "15687", path: "Clothing, Shoes & Accessories > Men > Men's Clothing > Shirts > T-Shirts" };
vi.mock("@/lib/ebay-inventory", async (orig) => ({
  ...(await orig<typeof import("@/lib/ebay-inventory")>()),
  inventoryRequest: async (_m: string, path: string) => {
    if (path.includes("get_category_suggestions")) {
      const parts = TEES.path.split(" > ");
      return {
        status: 200,
        data: { categorySuggestions: [{ category: { categoryId: TEES.id, categoryName: parts[parts.length - 1] }, categoryTreeNodeAncestors: parts.slice(0, -1).reverse().map((n, i, arr) => ({ categoryName: n, categoryTreeNodeLevel: arr.length - i })) }] },
      };
    }
    return { status: 404, data: {} };
  },
}));
vi.mock("@/lib/ebay-aspects", async (orig) => {
  const real = await orig<typeof import("@/lib/ebay-aspects")>();
  const { parseAspectDefs } = await import("@/lib/item-specifics");
  const d = (name: string, o: { req?: boolean; sel?: boolean; values?: string[] } = {}) => ({
    localizedAspectName: name,
    aspectConstraint: { aspectRequired: !!o.req, aspectUsage: o.req ? "REQUIRED" : "RECOMMENDED", aspectMode: o.sel ? "SELECTION_ONLY" : "FREE_TEXT", itemToAspectCardinality: "SINGLE" },
    aspectValues: (o.values ?? []).map((v) => ({ localizedValue: v })),
  });
  const defs = [d("Brand", { req: true }), d("Size", { req: true }), d("Department", { req: true, sel: true, values: ["Men", "Women"] }), d("Type", { req: true, sel: true, values: ["T-Shirt"] }), d("Color")];
  return { ...real, fetchAspectDefs: async () => parseAspectDefs({ aspects: defs }), fetchAllowedConditions: async () => null };
});

import { analyzeAndEnrich } from "@/lib/analyze-core";
import { MemoryJobStore } from "./memory-store";
import { makeProcessors, type DraftWriter, type ProcessorDeps } from "./processors";
import { runWorker } from "./worker";

const HOST = "https://proj.supabase.co";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BATCH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const photo = (i: number) => `${HOST}/storage/v1/object/public/photos/${USER}/p${i}.jpg`;

const isVision = (body: unknown) =>
  JSON.stringify((body as { messages?: unknown }).messages ?? "").includes("image_url");

let visionCalls = 0;
let groupCalls = 0;
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = HOST;
  visionCalls = 0;
  groupCalls = 0;
  ai.mockReset();
  ai.mockImplementation(async (_k: string, body: unknown) => {
    if (isVision(body)) {
      visionCalls++;
      return {
        choices: [{ message: { content: JSON.stringify({
          itemType: "T-Shirt", department: "Men", brand: "Hanes", size: "L", color: "Black",
          condition: "Excellent used", flaws: "", suggestedTitle: "Hanes Men's T-Shirt Size L Black Cotton Crew Neck",
          tag: { brand: "Hanes", size: "L", fiber: "100% Cotton" },
        }) } }],
      };
    }
    return passBAnswer(body, { Brand: "Hanes", Size: "L", Department: "Men", Type: "T-Shirt", Color: "Black" });
  });
});

function memoryDrafts() {
  const rows = new Map<string, Record<string, unknown>>();
  let failNextInsert = false;
  const writer: DraftWriter & { rows: typeof rows; failOnce(): void } = {
    rows,
    failOnce: () => {
      failNextInsert = true;
    },
    async findBySourceJob(jobId) {
      for (const [id, r] of rows) if (r.source_job_id === jobId) return id;
      return null;
    },
    async insert(jobId, row) {
      if (failNextInsert) {
        failNextInsert = false;
        throw new Error("connection reset");
      }
      for (const [id, r] of rows) if (r.source_job_id === jobId) return id; // unique source_job_id
      const id = `draft-${rows.size + 1}`;
      rows.set(id, { ...row, source_job_id: jobId });
      return id;
    },
  };
  return writer;
}

function fakeEbay() {
  const listings = new Map<string, string>();
  let publishCalls = 0;
  return {
    listings,
    get calls() {
      return publishCalls;
    },
    async publish(_ctx: unknown, draftId: string) {
      publishCalls++;
      // Same guard as publish-draft.ts: an already-listed draft isn't listed again.
      const id = listings.get(draftId) ?? `1100${listings.size + 1}`;
      listings.set(draftId, id);
      return { status: 200, json: { success: true, listingId: id, url: `https://www.ebay.com/itm/${id}` } };
    },
  };
}

function setup() {
  const clock = { t: Date.parse("2026-11-18T10:00:00Z") };
  const store = new MemoryJobStore(() => clock.t);
  const drafts = memoryDrafts();
  const ebay = fakeEbay();
  const usage = { calls: 0 };
  const deps: ProcessorDeps = {
    apiKey: "sk-test",
    store,
    drafts,
    checkAiUsage: async (_u, n) => {
      usage.calls += n;
      return { allowed: true, remaining: 1000, message: "" };
    },
    analyze: analyzeAndEnrich,
    resolveImages: async (images) => images,
    price: async () => ({ suggestedPrice: 24, avgSold: 25, activeRangeLow: 10, activeRangeHigh: 40, sellOdds: "Medium", comparableSoldCount: 0, comparableActiveCount: 8 }),
    fetchImageBase64: async () => undefined,
    ebayConnection: async (userId) => ({ userId, ebayUserId: "seller", refreshToken: "x", policies: {} }),
    publish: (ctx, draftId) => ebay.publish(ctx, draftId),
    groupChunk: async (_k, parts) => {
      groupCalls++;
      // An item every 3 photos, by the photo number in the URL.
      const groups: number[][] = [];
      parts.forEach((p, local) => {
        const n = Number(p.image_url.url.match(/p(\d+)\.jpg/)![1]);
        if (local === 0 || n % 3 === 0) groups.push([local]);
        else groups[groups.length - 1].push(local);
      });
      return { groups };
    },
  };
  const run = () =>
    runWorker({ store, processors: makeProcessors(deps), now: () => clock.t, sleep: async (ms) => { clock.t += ms; } });
  /** Runs the self-chain until it stops, like Vercel would. */
  const drain = async () => {
    let n = 0;
    let r = await run();
    while (r.shouldChain && n++ < 50) r = await run();
    return r;
  };
  return { clock, store, drafts, ebay, usage, deps, run, drain };
}

describe("background pipeline (mocked AI + eBay)", () => {
  it("groups on the server, analyzes every item into a Ready draft, then lists all Ready once", async () => {
    const { store, drafts, ebay, drain } = setup();
    const photos = Array.from({ length: 30 }, (_, i) => photo(i));
    await store.enqueue([{ user_id: USER, batch_id: BATCH, item_key: "batch", kind: "group", input: { photoUrls: photos } }]);

    await drain();
    const analyze = store.jobs.filter((j) => j.kind === "analyze");
    expect(analyze).toHaveLength(10);
    expect(store.jobs.every((j) => j.status === "done")).toBe(true);
    expect(groupCalls).toBeGreaterThanOrEqual(2); // chunked
    expect(visionCalls).toBe(10); // exactly one analysis per item
    expect(drafts.rows.size).toBe(10);
    const first = [...drafts.rows.values()][0];
    expect(first).toMatchObject({ user_id: USER, title: expect.stringContaining("Hanes"), suggested_price: 24, shipping_mode: "calculated" });
    expect((first.photo_urls as string[]).length).toBe(3);
    expect(analyze.map((j) => (j.result as { reasons?: string[] }).reasons)).toEqual(analyze.map(() => []));
    expect(analyze.every((j) => (j.result as { ready?: boolean }).ready === true)).toBe(true);

    // "List all Ready" -> publish jobs (enqueued twice: still one job each).
    const publish = analyze.map((j) => ({ user_id: USER, batch_id: BATCH, item_key: j.draft_id!, kind: "publish" as const, input: { draftId: j.draft_id } }));
    await store.enqueue(publish);
    await store.enqueue(publish);
    await drain();
    expect(ebay.listings.size).toBe(10);
    expect(ebay.calls).toBe(10);
    expect(store.jobs.filter((j) => j.kind === "publish").every((j) => j.status === "done" && (j.result as { url?: string }).url)).toBe(true);
  });

  it("a crash after the AI step doesn't pay for the AI again, and never makes two drafts", async () => {
    const { store, drafts, clock, drain, usage } = setup();
    await store.enqueue([{ user_id: USER, batch_id: BATCH, item_key: "0", kind: "analyze", input: { photoUrls: [photo(0), photo(1)] } }]);
    drafts.failOnce(); // saving the draft fails the first time
    await drain();
    if (store.jobs[0].status !== "done") {
      clock.t += 60_000;
      await drain();
    }
    expect(store.jobs[0].status).toBe("done");
    expect(visionCalls).toBe(1);
    expect(usage.calls).toBe(1);
    expect(drafts.rows.size).toBe(1);
  });

  it("a worker that dies mid-job: the lease expires, the job is picked up again, still one draft", async () => {
    const { store, drafts, clock, drain, deps } = setup();
    await store.enqueue([{ user_id: USER, batch_id: BATCH, item_key: "0", kind: "analyze", input: { photoUrls: [photo(0)] } }]);
    // Simulate: claimed, analyzed and drafted, then the function was killed before settling.
    const [j] = await store.claim({ kinds: ["analyze"], limit: 1, perUserLimit: 6, leaseSeconds: 90 });
    await makeProcessors(deps).analyze(j, { checkpoint: (r) => store.checkpoint(j, r), deadline: clock.t + 45_000, now: () => clock.t });
    expect(drafts.rows.size).toBe(1);
    clock.t += 91_000;
    await drain();
    expect(store.jobs[0]).toMatchObject({ status: "done", attempts: 2 });
    expect(drafts.rows.size).toBe(1);
    expect(visionCalls).toBe(1);
  });

  it("dead-letters after 3 failed attempts (Needs a look) and respects the AI cap", async () => {
    const { store, drain, deps, clock } = setup();
    deps.analyze = async () => {
      throw new Error("OpenAI 500");
    };
    await store.enqueue([{ user_id: USER, batch_id: BATCH, item_key: "0", kind: "analyze", input: { photoUrls: [photo(0)] } }]);
    for (let i = 0; i < 5; i++) {
      await drain();
      clock.t += 120_000;
    }
    expect(store.jobs[0]).toMatchObject({ status: "dead", attempts: 3 });

    deps.checkAiUsage = async () => ({ allowed: false, remaining: 0, reason: "day", message: "You've reached today's AI safety limit (600 calls). It resets at midnight UTC." });
    await store.enqueue([{ user_id: USER, batch_id: BATCH, item_key: "1", kind: "analyze", input: { photoUrls: [photo(1)] } }]);
    await drain();
    expect(store.jobs[1]).toMatchObject({ status: "dead", error: expect.stringContaining("today's AI safety limit") });
  });

  it("ignores photo URLs that aren't our own storage", async () => {
    const { store, drain } = setup();
    await store.enqueue([{ user_id: USER, batch_id: BATCH, item_key: "0", kind: "analyze", input: { photoUrls: ["https://evil.example.com/x.jpg"] } }]);
    await drain();
    expect(store.jobs[0]).toMatchObject({ status: "dead", error: "No uploaded photos for this item." });
    expect(visionCalls).toBe(0);
  });

  it("eBay not connected → Needs a look right away (no retries)", async () => {
    const { store, drain, deps } = setup();
    deps.ebayConnection = async () => null;
    await store.enqueue([{ user_id: USER, batch_id: BATCH, item_key: "d1", kind: "publish", input: { draftId: "d1" } }]);
    await drain();
    expect(store.jobs[0]).toMatchObject({ status: "dead", attempts: 1 });
  });
});
