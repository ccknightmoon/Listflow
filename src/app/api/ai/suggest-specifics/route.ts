import { NextRequest, NextResponse } from "next/server";
import { openAIPost } from "@/lib/openai-request";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { title, brand, color, size, condition, flaws } = await req.json();

    const prompt = `You are an expert eBay clothing reseller. Based on the item info below, suggest values for the missing eBay item specifics. Return ONLY a JSON object with these exact keys (use null if genuinely unknown):

Item info:
- Title: ${title || "unknown"}
- Brand: ${brand || "unknown"}
- Color: ${color || "unknown"}
- Size: ${size || "unknown"}
- Condition: ${condition || "unknown"}
- Flaws: ${flaws || "none"}

Return JSON with these keys:
{
  "item_type": "e.g. T-Shirt, Hoodie, Sweatshirt, Jacket, Jeans, Shorts, Dress, Pants",
  "style": "e.g. Pullover, Zip-Up, Button-Up, Crew Neck, V-Neck, Bomber, Denim",
  "material": "e.g. Cotton, Polyester, Denim, Wool, Fleece, Blend",
  "theme": "e.g. Vintage, Band Tee, Sports, Graphic, Streetwear, Workwear, or null",
  "sleeve_length": "Short Sleeve, Long Sleeve, Sleeveless, or null",
  "neckline": "Crew Neck, V-Neck, Turtleneck, Scoop Neck, Polo, or null",
  "fit": "Regular, Slim, Relaxed, Oversized, or null",
  "pattern": "Solid, Graphic Print, Striped, Plaid, Camo, or null",
  "description": "A 3-5 sentence eBay listing description highlighting the item, brand, condition, and any notable features. Mention flaws honestly if any."
}`;

    const response = await openAIPost(process.env.OPENAI_API_KEY!, {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 500,
    }) as { choices: Array<{ message: { content: string } }> };

    const result = JSON.parse(response.choices[0].message.content);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
