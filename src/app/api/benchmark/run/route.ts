import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { tradingRequest, isValidEbayItemId } from "@/lib/ebay-inventory";
import { openAIPost } from "@/lib/openai-request";
import { ITEM_VISION_PROMPT } from "@/lib/vision-prompt";
import { visionModel } from "@/lib/ai-models";
import { enrichVisionResult } from "@/lib/listing-enrich";
import { scoreItem } from "@/lib/benchmark";
import { parseGetItem } from "@/lib/benchmark-gold";

export const runtime = "nodejs";
export const maxDuration = 60;

// READ-ONLY benchmark of ONE live listing: read Sel's listing (GetItem),
// run the same AI pipeline as Batch Upload on its photos, compare with
// Sel's own title/category/specifics. Never lists, edits or ends anything.
// Costs one vision + one text AI call (not counted against the monthly cap).
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not configured." }, { status: 500 });
  const connection = await requireEbayConnection(auth);
  if (!connection) return NextResponse.json({ error: "eBay not connected." }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { itemId?: string; model?: string };
  const itemId = String(body.itemId ?? "");
  if (!isValidEbayItemId(itemId)) return NextResponse.json({ error: "Invalid item id" }, { status: 400 });
  const model = visionModel(body.model);

  return ebayContext.run(connection, async () => {
    const r = await tradingRequest(
      "GetItem",
      `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${itemId}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>true</IncludeItemSpecifics></GetItemRequest>`,
    );
    const gold = parseGetItem(r.body);
    if (!gold || gold.pictures.length === 0) return NextResponse.json({ itemId, skipped: "no photos or unreadable listing" });

    const started = Date.now();
    try {
      const data = (await openAIPost(apiKey, {
        model,
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: [{ type: "text", text: ITEM_VISION_PROMPT }, ...gold.pictures.slice(0, 6).map((url) => ({ type: "image_url", image_url: { url } }))] }],
      })) as { choices?: { message?: { content?: string } }[] };
      const vision = JSON.parse((data.choices?.[0]?.message?.content ?? "{}").replace(/```json|```/g, "").trim());
      const e = await enrichVisionResult(apiKey, vision, (fn) => ebayContext.run(connection, fn));
      const pred = {
        categoryId: (e.categoryId as string | null) ?? null,
        categoryPath: (e.categoryPath as string | null) ?? null,
        specifics: (e.itemSpecifics as Record<string, string[]>) ?? {},
        title: String(e.suggestedTitle ?? ""),
        missingRequired: (e.missingRequired as string[]) ?? [],
        ready: !!(e.confidence as { ready?: boolean } | undefined)?.ready,
      };
      return NextResponse.json({
        itemId, model, ms: Date.now() - started,
        gold: { title: gold.title, categoryPath: gold.categoryPath, specifics: gold.specifics },
        pred,
        reasons: (e.confidence as { reasons?: unknown } | undefined)?.reasons ?? [],
        score: scoreItem(gold, pred),
      });
    } catch (err) {
      return NextResponse.json({ itemId, error: (err as Error).message }, { status: 200 });
    }
  });
}
