import { NextRequest, NextResponse } from "next/server";
import { openAIPost } from "@/lib/openai-request";

export const runtime = "nodejs";

const prompt = `You are helping a reseller list a clothing item on eBay.
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

  const imageContent = images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: `data:${img.mediaType};base64,${img.data}` },
  }));

  try {
    const data = await openAIPost(apiKey, {
      model: "gpt-4o-mini",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, ...imageContent],
        },
      ],
    }) as { choices?: { message?: { content?: string } }[] };

    const rawText = data.choices?.[0]?.message?.content ?? "";
    const cleaned = rawText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "Could not parse OpenAI's response.", raw: rawText },
        { status: 502 }
      );
    }

    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json(
      { error: `Request failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
