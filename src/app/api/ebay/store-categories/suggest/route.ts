import { NextRequest, NextResponse } from "next/server";
import { openAIPost } from "@/lib/openai-request";
import { requireUser } from "@/lib/auth";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { fetchStoreCategories } from "@/lib/ebay-store-categories";
import { checkAndConsumeAiUsage, AI_USAGE_LIMIT_MESSAGE } from "@/lib/ai-usage";

export const runtime = "nodejs";

const MAX_ATTEMPTS = 3;
const RATE_LIMIT_DELAY_MS = 15000;
const RETRY_DELAY_MS = 2000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Settings -> "Store category suggestions" -> AI suggestions -> On. A
// text-only (no photos needed -- the item's already-detected fields are
// enough) call that picks the single best-fitting category from the
// seller's OWN real Store Category list (fetched fresh via
// fetchStoreCategories, the same source the manual dropdown uses), never
// an invented one. Costs one AI call per item on top of the free keyword
// match every seller already gets automatically (see
// src/lib/store-category-match.ts) -- opt-in for exactly that reason, and
// double-checked server-side (not just gated by the Settings UI) so a
// stale client can't spend AI usage this account didn't consent to.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const { user, supabase } = auth;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured on the server." }, { status: 500 });
  }

  const { data: settingsRow } = await supabase
    .from("app_settings")
    .select("ai_store_category_suggestions")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!settingsRow?.ai_store_category_suggestions) {
    return NextResponse.json({ error: "AI store category suggestions are off in Settings." }, { status: 400 });
  }

  const connection = await requireEbayConnection(auth);
  if (!connection) {
    return NextResponse.json({ error: "eBay not connected.", connect: true }, { status: 400 });
  }

  let body: { title?: string; itemType?: string; brand?: string; color?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const title = (body.title || "").trim();
  if (!title) {
    return NextResponse.json({ categoryId: null, categoryPath: null });
  }

  return ebayContext.run(connection, async () => {
    const categories = await fetchStoreCategories();
    if (categories.length === 0) {
      return NextResponse.json({ categoryId: null, categoryPath: null });
    }

    const usage = await checkAndConsumeAiUsage(user.id, 1);
    if (!usage.allowed) {
      return NextResponse.json({ error: AI_USAGE_LIMIT_MESSAGE }, { status: 429 });
    }

    const itemLines = [
      `Title: ${title}`,
      body.itemType ? `Type: ${body.itemType}` : null,
      body.brand ? `Brand: ${body.brand}` : null,
      body.color ? `Color: ${body.color}` : null,
      body.description ? `Description: ${body.description}` : null,
    ].filter(Boolean).join("\n");

    const categoryLines = categories.map((c) => `${c.id}: ${c.path}`).join("\n");

    const prompt = `A reseller organizes their eBay Store into custom categories. Given
one item's details and the seller's own list of real store categories,
pick the single best-fitting category for this item.

Item:
${itemLines}

Store categories (id: path):
${categoryLines}

Respond with ONLY a JSON object (no markdown, no extra text) in this exact
shape: {"categoryId": "123"} using the exact id from the list above, or
{"categoryId": null} if none of the categories genuinely fit this item --
never invent an id that isn't in the list.`;

    let lastError: string | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const data = await openAIPost(apiKey, {
          model: "gpt-4o-mini",
          max_tokens: 50,
          messages: [{ role: "user", content: prompt }],
        }) as { choices?: { message?: { content?: string } }[] };

        const rawText = data.choices?.[0]?.message?.content ?? "";
        const cleaned = rawText.replace(/```json|```/g, "").trim();

        let parsed: { categoryId?: string | number | null };
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          return NextResponse.json(
            { error: "Could not parse category suggestion response.", raw: rawText },
            { status: 502 }
          );
        }

        const candidateId = parsed.categoryId != null ? String(parsed.categoryId) : null;
        const match = candidateId ? categories.find((c) => c.id === candidateId) : undefined;

        return NextResponse.json({
          categoryId: match?.id ?? null,
          categoryPath: match?.path ?? null,
        });
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
  });
}
