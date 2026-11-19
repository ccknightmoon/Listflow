import { visionModel } from "@/lib/ai-models";
import { NextRequest, NextResponse } from "next/server";
import { openAIPost } from "@/lib/openai-request";
import { requireUser } from "@/lib/auth";
import { checkAndConsumeAiUsage, AI_USAGE_LIMIT_MESSAGE } from "@/lib/ai-usage";
import { ITEM_VISION_PROMPT as PROMPT } from "@/lib/vision-prompt";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { enrichVisionResult } from "@/lib/listing-enrich";
import { withBackoff } from "@/lib/backoff";
import { ALL_HIGH_UP_TO, MAX_ANALYSIS_PHOTOS, planDetail, TAG_FINDER_PROMPT, type Detail, type TagFinderAnswer } from "@/lib/photo-plan";

export const runtime = "nodejs";
// Vision + category specifics fill can take a while on big photo sets.
export const maxDuration = 60;

type InImage = { data?: string; mediaType?: string; url?: string };

// Only our own uploaded photos (Supabase storage) are passed to OpenAI by URL.
function isOwnPhotoUrl(u: string): boolean {
  try {
    const url = new URL(u);
    const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local");
    return url.protocol === "https:" && url.host === base.host && url.pathname.startsWith("/storage/v1/object/public/");
  } catch {
    return false;
  }
}

/** OpenAI image part: an uploaded photo by URL (no request-size limit), else inline data. */
function imagePart(img: InImage, detail: Detail) {
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
async function analyzeGroup(apiKey: string, imagesIn: InImage[], timings: Record<string, number>) {
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

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  let body: { groups?: { images: InImage[] }[] };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const groups = body.groups ?? [];

  if (groups.length === 0) {
    return NextResponse.json(
      { error: "At least one group is required." },
      { status: 400 }
    );
  }

  // Each group here is one real OpenAI call, so the usage cap is consumed
  // per-group, not per-request -- a 20-item batch should count as 20, not 1.
  // If the whole batch doesn't fit this month's remaining budget, process as
  // many groups as still fit (consuming exactly that many) and mark the rest
  // capped, rather than failing the entire batch over a partial shortfall.
  const requested = groups.length;
  const usage = await checkAndConsumeAiUsage(auth.user.id, requested);
  let processLimit = requested;
  if (!usage.allowed) {
    processLimit = usage.remaining;
    if (processLimit > 0) {
      await checkAndConsumeAiUsage(auth.user.id, processLimit);
    }
  }

  const results = [];
  const connection = await requireEbayConnection(auth).catch(() => null);
  const runWithEbay = connection ? <T,>(fn: () => Promise<T>) => ebayContext.run(connection, fn) : null;

  for (let i = 0; i < groups.length; i++) {
    if (i >= processLimit) {
      results.push({ error: usage.message || AI_USAGE_LIMIT_MESSAGE });
      continue;
    }
    const timings: Record<string, number> = {};
    try {
      const result = await analyzeGroup(apiKey, groups[i].images ?? [], timings);
      const t = Date.now();
      const enriched = await enrichVisionResult(apiKey, result, runWithEbay);
      timings.enrichMs = Date.now() - t;
      // Per-stage timings: returned to the page and logged for Vercel logs.
      console.log(JSON.stringify({ event: "analyze_item", ...timings }));
      results.push({ ...enriched, timings });
    } catch (err) {
      results.push({ error: (err as Error).message, rateLimited: !!(err as { isRateLimit?: boolean }).isRateLimit, timings });
    }

  }

  return NextResponse.json({ results });
}
