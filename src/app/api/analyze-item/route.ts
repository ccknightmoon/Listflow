import { NextRequest, NextResponse } from "next/server";
import { openAIPost } from "@/lib/openai-request";

export const runtime = "nodejs";

const prompt = `You are helping a reseller list a clothing item on eBay.
Look at these photos (front/back, measurements, and any flaw close-ups) and
respond with ONLY a JSON object (no markdown, no extra text) in this exact shape:

{
  "itemType": "eBay Type value, e.g. 'T-Shirt', 'Hoodie', 'Jeans', 'Jacket', 'Shorts', 'Sweatshirt', 'Polo', 'Vest'",
  "brand": "brand name visible on item, or 'Unbranded' if none",
  "color": "primary color, e.g. White, Black, Blue, Red, Grey, Green, Brown, Beige",
  "size": "size from tag/label if visible, e.g. S, M, L, XL, XXL, 32x30 — or 'Unknown'",
  "condition": "one of: New with tags, New without tags, Excellent used, Good - minor flaws, Fair - notable flaws",
  "flaws": "specific visible flaws (stains, holes, fading, pilling) or empty string if none",
  "vintage": "'Yes' if the item appears to be from before 2000, otherwise 'No'",
  "style": "eBay Style value — one of: Graphic Tee, Polo, Henley, V-Neck, Crewneck, Relaxed Fit, Athletic, Activewear, Workwear, Preppy, Casual. Empty string if none apply.",
  "material": "primary fabric — one of: Cotton, Polyester, Denim, Fleece, Wool, Nylon, Linen, Velvet, Corduroy, Silk, Synthetic, or blend e.g. Cotton/Polyester. Empty string if unknown.",
  "sleeveLength": "for tops only — one of: Short Sleeve, Long Sleeve, Sleeveless, 3/4 Sleeve. Empty string for bottoms/outerwear.",
  "neckline": "for tops only — one of: Crew Neck, V-Neck, Hooded, Turtleneck, Mock Neck, Collared. Empty string for bottoms/outerwear.",
  "fit": "one of: Regular, Slim, Relaxed, Oversized, Athletic",
  "pattern": "eBay Pattern value — one of: Graphic Print, Solid, Striped, Plaid, Floral, Camouflage, Tie Dye, Checkered, Abstract. Use 'Graphic Print' for items with text, logos, or character prints.",
  "theme": "comma-separated eBay Theme values that apply, e.g. '90s', 'Vintage', 'Sports', 'Music', 'TV & Movie', 'Holiday', 'Halloween', 'Military', 'Animal', 'Nature', 'Humor'. Empty string if none.",
  "character": "specific character name if item features one, e.g. 'Mickey Mouse', 'SpongeBob', 'Bugs Bunny', 'Stitch', 'Tupac'. Empty string if no character.",
  "characterFamily": "franchise/brand of character if any, e.g. 'Disney', 'Nickelodeon', 'Looney Tunes', 'Marvel', 'DC Comics'. Empty string if no character.",
  "yearManufactured": "estimated decade range — one of: Pre-1960, 1960-1969, 1970-1979, 1980-1989, 1990-1999, 2000-2009, 2010-2019, 2020-2029. Base on style, font, printing technique, tag style. Empty string if truly unknown.",
  "season": "one of: All Seasons, Fall, Spring, Summer, Winter. Default to 'All Seasons' for most clothing.",
  "pitToPit": "TOPS ONLY — armpit to armpit (chest width) read from the measuring tape in the photo, e.g. '22 inches'. Read the tape carefully. Empty string if no tape visible, not a top, or unclear.",
  "length": "TOPS ONLY — shoulder seam to bottom hem read from the measuring tape, e.g. '28 inches'. Empty string if not visible or not a top.",
  "waist": "BOTTOMS ONLY — waist measurement from tape. If tape is folded flat across the waistband, double the value shown. Return the full circumference, e.g. '32 inches'. Empty string if not a bottom or not visible.",
  "inseam": "BOTTOMS ONLY — inseam length read from tape, e.g. '30 inches'. Empty string if not visible or not a bottom.",
  "description": "2-3 sentences, buyer-facing. Describe what the item is, notable design details, who would wear it, and any key selling points. No filler phrases.",
  "suggestedTitle": "eBay listing title — keyword-rich, MAXIMUM 80 characters (count carefully, never exceed 80). Pack in: Brand + Men's/Women's/Unisex + Item Type + Color + Size + keywords like Vintage, Y2K, 90s, Graphic Tee, Band Tee, Streetwear, Distressed, Oversized. No filler phrases. Aim for all 80 characters."
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
