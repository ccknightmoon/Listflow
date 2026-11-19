// AI photo grouping for one chunk of photos, shared by POST /api/group-photos
// (in-browser flow) and the background queue worker (Volume Phase 3).
import { openAIPost } from "@/lib/openai-request";
import { checkGrouping, repairGroups, groupsFromStarts } from "@/lib/grouping-repair";

const MAX_ATTEMPTS = 3;
const RATE_LIMIT_DELAY_MS = 15000;
const RETRY_DELAY_MS = 2000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type GroupImagePart = { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export interface GroupChunkResult {
  groups: number[][];
  retried?: boolean;
  repairs?: { autoPlaced: { photo: number; group: number }[]; duplicatesRemoved: number[]; unusable: boolean };
}

/** Groups `parts` (in shooting order) into items. Throws if the AI can't be reached. */
export async function groupPhotosCore(apiKey: string, parts: GroupImagePart[]): Promise<GroupChunkResult> {
  const n = parts.length;
  const imageContent = parts.flatMap((part, i) => [
    { type: "text" as const, text: `Photo index ${i}:` },
    part,
  ]);

  const prompt = `You are helping a reseller organize a batch of clothing
photos taken in order. The photos were taken item by item: a clear, full
front-view shot of a garment marks the START of a new item. Photos that
follow it (measurements laid flat with a tape measure, close-ups of flaws,
back views, tag close-ups, etc.) belong to that same item, until the next
clear front-view shot appears.

There are ${n} photos, indexed 0 to ${n - 1} in the
order shown above.

Group them into items. Respond with a JSON object like:

{
  "groups": [[0,1,2],[3,4],[5,6,7,8]]
}

Each inner array lists the photo indices belonging to one item, in
ascending order. Every index from 0 to ${n - 1} must appear
in exactly one group -- do not skip any photo, even a blurry or
close-up one (it belongs to the item before it). Order the groups by the
index of their first photo.`;

  // Strict retry: one answer per photo ("does it start a new item?"), so
  // the model has to look at every index and can't silently drop one.
  const strictPrompt = `${prompt.split("Group them into items.")[0]}
For EVERY photo index from 0 to ${n - 1} (that is ${n} entries, in order, none skipped),
say whether that photo starts a new item (a clear full front view of a new garment).
Photo 0 always starts a new item. Respond with JSON like:
{ "photos": [ { "index": 0, "startsNewItem": true }, { "index": 1, "startsNewItem": false }, ... ] }`;

  let lastError: string | null = null;

  // gpt-4o-mini, not gpt-4o: deciding "does this photo start a new item"
  // is an easier call than the full per-item analysis (which also runs on
  // mini), and mini is cheaper and faster.
  //
  // Network / rate-limit failures retry (up to MAX_ATTEMPTS). A complete
  // but imperfect answer (a photo missing or listed twice) gets ONE strict
  // retry, then is repaired in code (src/lib/grouping-repair.ts) -- one
  // dropped photo never fails the whole batch any more (Nov 2026: Sel's
  // first real 28-photo batch failed on "missing: [9]").
  async function ask(content: string, schema: object): Promise<unknown> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const data = (await openAIPost(apiKey, {
          model: "gpt-4o-mini",
          max_tokens: 4000,
          response_format: { type: "json_schema", json_schema: { name: "photo_grouping", strict: true, schema } },
          messages: [{ role: "user", content: [{ type: "text", text: content }, ...imageContent] }],
        })) as { choices?: { message?: { content?: string } }[] };
        const rawText = data.choices?.[0]?.message?.content ?? "";
        try {
          return JSON.parse(rawText.replace(/```json|```/g, "").trim());
        } catch {
          lastError = "Could not parse grouping response.";
          return null;
        }
      } catch (err) {
        lastError = (err as Error).message;
        const isRateLimit = (err as { isRateLimit?: boolean }).isRateLimit;
        if (attempt < MAX_ATTEMPTS) await delay(isRateLimit ? RATE_LIMIT_DELAY_MS : RETRY_DELAY_MS * attempt);
      }
    }
    throw new Error(`Request failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
  }

  const groupsSchema = {
    type: "object",
    additionalProperties: false,
    required: ["groups"],
    properties: { groups: { type: "array", items: { type: "array", items: { type: "integer" } } } },
  };
  const strictSchema = {
    type: "object",
    additionalProperties: false,
    required: ["photos"],
    properties: {
      photos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "startsNewItem"],
          properties: { index: { type: "integer" }, startsNewItem: { type: "boolean" } },
        },
      },
    },
  };


    const first = (await ask(prompt, groupsSchema)) as { groups?: unknown } | null;
    const firstCheck = checkGrouping(first?.groups, n);
    if (firstCheck.ok) return { groups: first!.groups as number[][] };

    // One strict retry. Its per-photo answer always covers every photo.
    let strict: { photos?: unknown } | null = null;
    try {
      strict = (await ask(strictPrompt, strictSchema)) as { photos?: unknown } | null;
    } catch {
      strict = null;
    }
    if (strict && Array.isArray(strict.photos) && strict.photos.length > 0) {
      return { groups: groupsFromStarts(strict.photos, n), retried: true };
    }

    // Fall back: repair the first answer and tell the seller what moved.
    const r = repairGroups(first?.groups, n);
    return { groups: r.groups, repairs: { autoPlaced: r.autoPlaced, duplicatesRemoved: r.duplicatesRemoved, unusable: r.unusable } };
}
