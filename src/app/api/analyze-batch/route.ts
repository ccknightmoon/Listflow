import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/analyze-batch
 *
 * Accepts multiple groups of photos (one group per item) and analyzes
 * them ONE AT A TIME (not in parallel) to stay within OpenAI's per-minute
 * token rate limit on smaller accounts. Images are sent in "low detail"
 * mode, which uses far fewer tokens per image while still being plenty
 * for reading tags, identifying brands/condition, and spotting flaws.
 *
 * Request body:
 * { "groups": [ { "images": [{ "data": "<base64>", "mediaType": "image/jpeg" }, ...] }, ... ] }
 *
 * Response:
 * { "results": [ { itemType, brand, color, size, condition, flaws, suggestedTitle }, ... ] }
 * If a group fails after retries, its entry will have an "error" field instead.
 */

const PROMPT = `You are helping a reseller list a clothing item on eBay.
Look at these photos (front/back, measurements, and any flaw close-ups) and
respond with ONLY a JSON object (no markdown, no extra text) in this exact
shape:

{
  "itemType": "string, e.g. 'hoodie', 'jeans', 'jacket'",
  "brand": "string, best guess at brand or 'Unknown'",
  "color": "string",
  "size": "string, best guess from tags/labels visible, or 'Unknown'",
  "condition": "one of: New with tags, New without tags, Excellent used, Good - minor flaws, Fair - notable flaws",
  "flaws": "short description of any visible flaws, or empty string if none",
  "suggestedTitle": "a concise eBay listing title under 80 characters"
}`;

const MAX_ATTEMPTS = 3;
const NORMAL_RETRY_DELAY_MS = 1000;
const RATE_LIMIT_RETRY_DELAY_MS = 15000;
const DELAY_BETWEEN_ITEMS_MS = 1500;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOpenAi(
  apiKey: string,
  images: { data: string; mediaType: string }[]
) {
  const imageContent = images.map((img) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:${img.mediaType};base64,${img.data}`,
      detail: "low" as const,
    },
  }));

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: PROMPT }, ...imageContent],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    const isRateLimit = errText.includes("rate_limit_exceeded");
    const error = new Error(`OpenAI API error: ${errText}`);
    (error as Error & { isRateLimit?: boolean }).isRateLimit = isRateLimit;
    throw error;
  }

  const data = await response.json();
  const rawText: string = data.choices?.[0]?.message?.content ?? "";
  const cleaned = rawText.replace(/```json|```/g, "").trim();

  return JSON.parse(cleaned);
}

async function analyzeGroupWithRetry(
  apiKey: string,
  images: { data: string; mediaType: string }[]
) {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callOpenAi(apiKey, images);
    } catch (err) {
      lastError = err as Error;
      const isRateLimit = (err as Error & { isRateLimit?: boolean }).isRateLimit;

      if (attempt < MAX_ATTEMPTS) {
        const waitTime = isRateLimit ? RATE_LIMIT_RETRY_DELAY_MS : NORMAL_RETRY_DELAY_MS * attempt;
        await delay(waitTime);
      }
    }
  }

  throw lastError;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  let body: { groups?: { images: { data: string; mediaType: string }[] }[] };

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

  const results = [];
  for (let i = 0; i < groups.length; i++) {
    try {
      const result = await analyzeGroupWithRetry(apiKey, groups[i].images);
      results.push(result);
    } catch (err) {
      results.push({ error: (err as Error).message });
    }

    if (i < groups.length - 1) {
      await delay(DELAY_BETWEEN_ITEMS_MS);
    }
  }

  return NextResponse.json({ results });
}
