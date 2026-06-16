import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/group-photos
 *
 * Accepts an ORDERED list of photos and asks the AI to group them into
 * separate items. The convention: a clear, full front-view shot of a
 * garment signals the start of a new item. Photos between two "front"
 * shots (measurements, flaw close-ups, back view, etc.) belong to the
 * item that came before them.
 *
 * Request body:
 * { "images": [{ "data": "<base64>", "mediaType": "image/jpeg" }, ...] }
 *
 * Response:
 * { "groups": [[0,1,2],[3,4],[5,6,7,8]] }
 * Each inner array is a list of indices (into the original images array)
 * belonging to one item, in the order they were uploaded.
 */
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
      image_url: { url: `data:${img.mediaType};base64,${img.data}` },
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

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }, ...imageContent],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `OpenAI API error: ${errText}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const rawText: string = data.choices?.[0]?.message?.content ?? "";
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
    return NextResponse.json(
      { error: `Request failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
