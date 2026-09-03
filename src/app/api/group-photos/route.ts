import { NextRequest, NextResponse } from "next/server";
import { openAIPost } from "@/lib/openai-request";
import { requireUser } from "@/lib/auth";
import { checkAndConsumeAiUsage, AI_USAGE_LIMIT_MESSAGE } from "@/lib/ai-usage";

export const runtime = "nodejs";

const MAX_ATTEMPTS = 3;
const RATE_LIMIT_DELAY_MS = 15000;
const RETRY_DELAY_MS = 2000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  let body: { images?: { data: string; mediaType: string }[] };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const images = body.images ?? [];

  if (images.length === 0) {
    return NextResponse.json(
      { error: "At least one image is required." },
      { status: 400 }
    );
  }

  const usage = await checkAndConsumeAiUsage(auth.user.id, 1);
  if (!usage.allowed) {
    return NextResponse.json({ error: AI_USAGE_LIMIT_MESSAGE }, { status: 429 });
  }

  // Standard (not "low") detail — grouping decisions and the downstream
  // analysis both depend on being able to actually read tags/measurements
  // in these photos, and low-detail tiles make that materially worse. This
  // is the bulk path, so getting it right here matters more, not less.
  const imageContent = images.flatMap((img, i) => [
    { type: "text" as const, text: `Photo index ${i}:` },
    {
      type: "image_url" as const,
      image_url: {
        url: `data:${img.mediaType};base64,${img.data}`,
      },
    },
  ]);

  const prompt = `You are helping a reseller organize a batch of clothing
photos taken in order. The photos were taken item by item: a clear, full
front-view shot of a garment marks the START of a new item. Photos that
follow it (measurements laid flat with a tape measure, close-ups of flaws,
back views, tag close-ups, etc.) belong to that same item, until the next
clear front-view shot appears.

There are ${images.length} photos, indexed 0 to ${images.length - 1} in the
order shown above.

Group them into items. Respond with ONLY a JSON object (no markdown, no
extra text) in this exact shape:

{
  "groups": [[0,1,2],[3,4],[5,6,7,8]]
}

Each inner array lists the photo indices belonging to one item, in
ascending order. Every index from 0 to ${images.length - 1} must appear
in exactly one group. Order the groups by the index of their first photo.`;

  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const data = await openAIPost(apiKey, {
        model: "gpt-4o",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }, ...imageContent],
          },
        ],
      }) as { choices?: { message?: { content?: string } }[] };

      const rawText = data.choices?.[0]?.message?.content ?? "";
      const cleaned = rawText.replace(/```json|```/g, "").trim();

      let parsed: { groups?: number[][] };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        return NextResponse.json(
          { error: "Could not parse grouping response.", raw: rawText },
          { status: 502 }
        );
      }

      if (!parsed.groups || !Array.isArray(parsed.groups)) {
        return NextResponse.json(
          { error: "Grouping response missing 'groups' array.", raw: rawText },
          { status: 502 }
        );
      }

      // The whole point of a bulk grouping tool is "don't miss items" — a
      // group response that drops or duplicates an index used to fail
      // silently (photos just vanished from the batch with no indication).
      // Verify every input index is accounted for exactly once before
      // trusting the response; if not, retry rather than return partial data.
      const seen = new Map<number, number>();
      for (const group of parsed.groups) {
        for (const idx of group) seen.set(idx, (seen.get(idx) ?? 0) + 1);
      }
      const missing: number[] = [];
      const duplicated: number[] = [];
      for (let i = 0; i < images.length; i++) {
        const count = seen.get(i) ?? 0;
        if (count === 0) missing.push(i);
        else if (count > 1) duplicated.push(i);
      }
      if (missing.length > 0 || duplicated.length > 0) {
        lastError = `Grouping response did not account for every photo (missing: [${missing.join(",")}], duplicated: [${duplicated.join(",")}]).`;
        if (attempt < MAX_ATTEMPTS) {
          await delay(RETRY_DELAY_MS * attempt);
          continue;
        }
        return NextResponse.json(
          { error: `${lastError} Try regrouping, or group this batch in smaller parts.`, raw: rawText },
          { status: 502 }
        );
      }

      return NextResponse.json({ groups: parsed.groups });
    } catch (err) {
      lastError = (err as Error).message;
      const isRateLimit = (err as { isRateLimit?: boolean }).isRateLimit;

      if (attempt < MAX_ATTEMPTS) {
        await delay(isRateLimit ? RATE_LIMIT_DELAY_MS : RETRY_DELAY_MS * attempt);
      }
    }
  }

  return NextResponse.json(
    { error: `Request failed after ${MAX_ATTEMPTS} attempts: ${lastError}` },
    { status: 500 }
  );
}
