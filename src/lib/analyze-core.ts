// Pass A vision + enrichment for one item, shared by POST /api/analyze-batch
// (in-browser flow) and the background queue worker (Volume Phase 3).
import { visionModel } from "@/lib/ai-models";
import { openAIPost } from "@/lib/openai-request";
import { ITEM_VISION_PROMPT as PROMPT } from "@/lib/vision-prompt";
import { enrichVisionResult } from "@/lib/listing-enrich";
import { withBackoff } from "@/lib/backoff";
import { ALL_HIGH_UP_TO, MAX_ANALYSIS_PHOTOS, planDetail, TAG_FINDER_PROMPT, type Detail, type TagFinderAnswer } from "@/lib/photo-plan";

export type InImage = { data?: string; mediaType?: string; url?: string };

// Only our own uploaded photos (Supabase storage) are passed to OpenAI by URL.
export function isOwnPhotoUrl(u: string): boolean {
  try {
    const url = new URL(u);
    const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local");
    // Public photos, or short-lived signed links to private draft photos
    // (src/lib/private-photos-server.ts).
    return url.protocol === "https:" && url.host === base.host &&
      (url.pathname.startsWith("/storage/v1/object/public/") || url.pathname.startsWith("/storage/v1/object/sign/photos-private/"));
  } catch {
    return false;
  }
}

/** OpenAI image part: an uploaded photo by URL (no request-size limit), else inline data. */
export function imagePart(img: InImage, detail: Detail) {
  const url = img.url && isOwnPhotoUrl(img.url) ? img.url : `data:${img.mediaType ?? "image/jpeg"};base64,${img.data ?? ""}`;
  return { type: "image_url" as const, image_url: { url, detail } };
}

/** Cheap low-detail pass: which photo is the front, which show tags/tape. */
async function findTags(apiKey: string, images: InImage[]): Promise<TagFinderAnswer | null> {
  try {
    const data = (await withBackoff(() => openAIPost(apiKey, {
      model: visionModel(),
      max_tokens: 100,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: [{ type: "text", text: TAG_FINDER_PROMPT }, ...images.map((img) => imagePart(img, "low"))] }],
    }), 2)) as { choices?: { message?: { content?: string } }[] };
    return JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as TagFinderAnswer;
  } catch {
    return null; // fall back to the front + last-shots heuristic
  }
}

/**
 * Pass A (vision) over EVERY photo of the item: front and tag/tape shots
 * at full detail, the rest at low detail (Volume Phase 1). Rate limits are
 * retried with backoff (src/lib/backoff.ts).
 */
export async function analyzeGroup(apiKey: string, imagesIn: InImage[], timings: Record<string, number>) {
  const images = imagesIn.slice(0, MAX_ANALYSIS_PHOTOS);
  let t = Date.now();
  const finder = images.length > ALL_HIGH_UP_TO ? await findTags(apiKey, images) : null;
  timings.tagFinderMs = Date.now() - t;
  const plan = planDetail(images.length, finder);
  const content = images.flatMap((img, i) => [
    { type: "text" as const, text: `Photo ${i}${plan[i] === "high" ? " (full detail)" : ""}:` },
    imagePart(img, plan[i]),
  ]);
  t = Date.now();
  const data = (await withBackoff(() => openAIPost(apiKey, {
    model: visionModel(),
    max_tokens: 2000,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, ...content] }],
  }), 3)) as { choices?: { message?: { content?: string } }[] };
  timings.visionMs = Date.now() - t;
  timings.photos = images.length;
  timings.highDetail = plan.filter((d) => d === "high").length;
  const rawText = data.choices?.[0]?.message?.content ?? "";
  return JSON.parse(rawText.replace(/```json|```/g, "").trim());
}


type RunWithEbay = (<T>(fn: () => Promise<T>) => Promise<T>) | null;

/** Vision pass + Pass B enrichment, with per-stage timings. Throws on failure. */
export async function analyzeAndEnrich(apiKey: string, images: InImage[], runWithEbay: RunWithEbay) {
  const timings: Record<string, number> = {};
  const result = await analyzeGroup(apiKey, images, timings);
  const t = Date.now();
  const enriched = await enrichVisionResult(apiKey, result, runWithEbay);
  timings.enrichMs = Date.now() - t;
  return { enriched, timings };
}
