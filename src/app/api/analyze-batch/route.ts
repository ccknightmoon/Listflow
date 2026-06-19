import { NextRequest, NextResponse } from "next/server";
import { openAIPost } from "@/lib/openai-request";

export const runtime = "nodejs";

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
  "suggestedTitle": "eBay listing title — keyword-rich, MAXIMUM 80 characters (count carefully, never exceed 80). Pack in as many buyer search terms as possible: Brand + Men's/Women's/Unisex + Item Type + Color + Size + style keywords (e.g. Vintage, Graphic Tee, Band Tee, Y2K, 90s, Streetwear, Distressed, Oversized). Do NOT use filler phrases like 'Great condition' or 'Fast shipping' — every word should be a search keyword. Aim to use all 80 characters."
}`;

const MAX_ATTEMPTS = 3;
const NORMAL_RETRY_DELAY_MS = 1000;
const RATE_LIMIT_RETRY_DELAY_MS = 15000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function analyzeGroup(
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

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const data = await openAIPost(apiKey, {
        model: "gpt-4o-mini",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: PROMPT }, ...imageContent],
          },
        ],
      }) as { choices?: { message?: { content?: string } }[] };

      const rawText = data.choices?.[0]?.message?.content ?? "";
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      return JSON.parse(cleaned);
    } catch (err) {
      lastError = err as Error;
      const isRateLimit = (err as { isRateLimit?: boolean }).isRateLimit;

      if (attempt < MAX_ATTEMPTS) {
        await delay(isRateLimit ? RATE_LIMIT_RETRY_DELAY_MS : NORMAL_RETRY_DELAY_MS * attempt);
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
      const result = await analyzeGroup(apiKey, groups[i].images);
      results.push(result);
    } catch (err) {
      results.push({ error: (err as Error).message });
    }

  }

  return NextResponse.json({ results });
}
