import { NextRequest, NextResponse } from "next/server";
import { openAIPost } from "@/lib/openai-request";
import { requireUser } from "@/lib/auth";
import { checkAndConsumeAiUsage, AI_USAGE_LIMIT_MESSAGE } from "@/lib/ai-usage";
import { ITEM_VISION_PROMPT as PROMPT } from "@/lib/vision-prompt";

export const runtime = "nodejs";

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
  // Standard detail, not "low" — this is the bulk vision-analysis path that
  // reads tag text and tape-measure numbers; low-detail tiles make that
  // meaningfully worse, and this path matters most for "auto-fill everything."
  const imageContent = images.map((img) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:${img.mediaType};base64,${img.data}`,
    },
  }));

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const data = await openAIPost(apiKey, {
        model: "gpt-4o-mini",
        max_tokens: 1000,
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
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;

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

  // Each group here is one real OpenAI call, so the usage cap is consumed
  // per-group, not per-request -- a 20-item batch should count as 20, not 1.
  // If the whole batch doesn't fit this month's remaining budget, process as
  // many groups as still fit (consuming exactly that many) and mark the rest
  // capped, rather than failing the entire batch over a partial shortfall.
  const requested = groups.length;
  const usage = await checkAndConsumeAiUsage(auth.user.id, requested);
  let processLimit = requested;
  if (!usage.allowed) {
    processLimit = usage.remaining;
    if (processLimit > 0) {
      await checkAndConsumeAiUsage(auth.user.id, processLimit);
    }
  }

  const results = [];

  for (let i = 0; i < groups.length; i++) {
    if (i >= processLimit) {
      results.push({ error: AI_USAGE_LIMIT_MESSAGE });
      continue;
    }
    try {
      const result = await analyzeGroup(apiKey, groups[i].images);
      results.push(result);
    } catch (err) {
      results.push({ error: (err as Error).message });
    }

  }

  return NextResponse.json({ results });
}
