import { NextRequest, NextResponse } from "next/server";
import { openAIPost } from "@/lib/openai-request";

export const runtime = "nodejs";

const MAX_ATTEMPTS = 3;
const RATE_LIMIT_DELAY_MS = 15000;
const RETRY_DELAY_MS = 2000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
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

  const imageContent = images.flatMap((img, i) => [
    { type: "text" as const, text: `Photo index ${i}:` },
    {
      type: "image_url" as const,
      image_url: {
        url: `data:${img.mediaType};base64,${img.data}`,
        detail: "low" as const,
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
