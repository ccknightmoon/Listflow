import { NextRequest, NextResponse } from "next/server";
import { openAIPost } from "@/lib/openai-request";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { title, brand, color, size, condition, flaws } = await req.json();

    const prompt = `You are an expert eBay clothing reseller. Based on the item info below, suggest values for eBay item specifics. Return ONLY a JSON object with these exact keys (use null if genuinely unknown):

Item info:
- Title: ${title || "unknown"}
- Brand: ${brand || "unknown"}
- Color: ${color || "unknown"}
- Size: ${size || "unknown"}
- Condition: ${condition || "unknown"}
- Flaws: ${flaws || "none"}

Return JSON with these keys:
{
  "item_type": "eBay Type — e.g. T-Shirt, Hoodie, Sweatshirt, Jacket, Jeans, Shorts, Dress, Pants",
  "style": "eBay Style — one of: Graphic Tee, Polo, Henley, V-Neck, Crewneck, Relaxed Fit, Athletic, Activewear, Workwear, Preppy, Casual — or null",
  "material": "primary fabric — e.g. Cotton, Polyester, Denim, Wool, Fleece, Cotton/Polyester — or null",
  "theme": "comma-separated eBay Theme values — e.g. '90s', 'Vintage', 'Sports', 'Music', 'TV & Movie', 'Military', 'Animal', 'Humor' — or null",
  "sleeve_length": "Short Sleeve, Long Sleeve, Sleeveless, 3/4 Sleeve, or null",
  "neckline": "Crew Neck, V-Neck, Hooded, Turtleneck, Mock Neck, Collared, or null",
  "fit": "Regular, Slim, Relaxed, Oversized, Athletic, or null",
  "pattern": "eBay Pattern — one of: Graphic Print, Solid, Striped, Plaid, Floral, Camouflage, Tie Dye, Checkered, Abstract — or null",
  "vintage": "'Yes' if the title/brand suggests pre-2000, otherwise 'No'",
  "character": "specific character name if in title e.g. 'Mickey Mouse', 'SpongeBob', 'Tupac' — or null",
  "character_family": "franchise of character e.g. 'Disney', 'Nickelodeon', 'Marvel' — or null",
  "year_manufactured": "estimated decade — one of: Pre-1960, 1960-1969, 1970-1979, 1980-1989, 1990-1999, 2000-2009, 2010-2019, 2020-2029 — or null",
  "season": "All Seasons, Fall, Spring, Summer, or Winter — default to All Seasons",
  "description": "2-3 sentences, buyer-facing. Describe what the item is, notable design details, and who would wear it. No filler phrases."
}`;

    const response = await openAIPost(process.env.OPENAI_API_KEY!, {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 700,
    }) as { choices: Array<{ message: { content: string } }> };

    const raw = JSON.parse(response.choices[0].message.content);
    const result = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, (v === "null" || v === "") ? null : v])
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
