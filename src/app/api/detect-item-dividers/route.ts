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

// Settings -> "Batch upload: item dividers" -> On. An alternative to
// /api/group-photos' similarity-based grouping for sellers who shoot a
// numbered marker (a card, a tag, the outside of a poly bag -- whatever
// they use) as the last photo of each item. Unlike grouping, this is a
// per-photo, order-independent classification -- "is this photo mainly a
// visible number, not the item" -- so unlike group-photos there is no
// "last group carries over as pending into the next chunk" dependency
// between chunks, and the client is free to fire multiple chunks
// concurrently instead of strictly one after another. See
// src/app/batch-upload/page.tsx's handleGroupPhotos for how the result
// is turned into groups (every marker photo closes the current item and
// is itself excluded from that item's photos) and how the extracted
// number pre-fills that item's SKU field.
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

  const imageContent = images.flatMap((img, i) => [
    { type: "text" as const, text: `Photo index ${i}:` },
    {
      type: "image_url" as const,
      image_url: {
        url: `data:${img.mediaType};base64,${img.data}`,
      },
    },
  ]);

  const prompt = `A reseller photographs items to sell. Between items, they
sometimes photograph a hand-written or printed number -- on a card, a tag,
a sticky note, or the outside of a clear poly bag/mailer -- to mark "this
item is done, the next photos are a new item." That marker photo shows
mainly the number itself, not a piece of clothing or merchandise being
worn/laid out for sale.

There are ${images.length} photos, indexed 0 to ${images.length - 1} in the
order shown above. Find every photo that is one of these number-marker
photos (there may be none, one, or several), and read the number/code
written on it.

Respond with ONLY a JSON object (no markdown, no extra text) in this exact
shape:

{
  "markers": [{ "index": 3, "code": "042" }, { "index": 9, "code": "043" }]
}

Only list photos that are genuinely a number marker -- not a regular item
photo that happens to include a price tag or size label as a secondary
detail. "code" is exactly the digits/characters visible, nothing added. If
no photo is a number marker, respond with {"markers": []}.`;

  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const data = await openAIPost(apiKey, {
        model: "gpt-4o-mini",
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

      let parsed: { markers?: { index?: number; code?: string }[] };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        return NextResponse.json(
          { error: "Could not parse divider-detection response.", raw: rawText },
          { status: 502 }
        );
      }

      if (!parsed.markers || !Array.isArray(parsed.markers)) {
        return NextResponse.json(
          { error: "Divider-detection response missing 'markers' array.", raw: rawText },
          { status: 502 }
        );
      }

      // Same "don't trust an out-of-range or malformed entry" posture as
      // group-photos' index accounting below -- silently drop anything
      // that doesn't cleanly map to a real photo in this chunk rather than
      // letting a bad index corrupt the caller's group-building.
      const markers = parsed.markers
        .filter(
          (m): m is { index: number; code: string } =>
            typeof m.index === "number" &&
            Number.isInteger(m.index) &&
            m.index >= 0 &&
            m.index < images.length &&
            typeof m.code === "string" &&
            m.code.trim().length > 0
        )
        .map((m) => ({ index: m.index, code: m.code.trim() }));

      return NextResponse.json({ markers });
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
