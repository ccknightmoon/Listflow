import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/analyze-batch
 *
 * Accepts multiple groups of photos (one group per item) and analyzes
 * each group in parallel using the same prompt as the single-item flow.
 *
 * Request body:
 * { "groups": [ { "images": [{ "data": "<base64>", "mediaType": "image/jpeg" }, ...] }, ... ] }
 *
 * Response:
 * { "results": [ { itemType, brand, color, size, condition, flaws, suggestedTitle }, ... ] }
 * If a group fails to analyze, its entry will have an "error" field instead.
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

async function analyzeGroup(
  apiKey: string,
  images: { data: string; mediaType: string }[]
) {
  const imageContent = images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: `data:${img.mediaType};base64,${img.data}` },
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
    throw new Error(`OpenAI API error: ${errText}`);
  }

  const data = await response.json();
  const rawText: string = data.choices?.[0]?.message?.content ?? "";
  const cleaned = rawText.replace(/```json|```/g, "").trim();

  return JSON.parse(cleaned);
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

  const results = await Promise.all(
    groups.map(async (group) => {
      try {
        const parsed = await analyzeGroup(apiKey, group.images);
        return parsed;
      } catch (err) {
        return { error: (err as Error).message };
      }
    })
  );

  return NextResponse.json({ results });
}
