import { imageListError } from "@/lib/input-validation";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { planGate } from "@/lib/billing/entitlements";
import { checkAndConsumeAiUsage, AI_USAGE_LIMIT_MESSAGE } from "@/lib/ai-usage";
import { requireEbayConnection } from "@/lib/ebay-connection";
import { ebayContext } from "@/lib/ebay-request-context";
import { enrichVisionResult } from "@/lib/listing-enrich";
import { analyzeGroup, type InImage } from "@/lib/analyze-core";
import { resolveImagesForOpenAI } from "@/lib/private-photos-server";

export const runtime = "nodejs";
// Vision + category specifics fill can take a while on big photo sets.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.user) return auth.unauthorized;
  const gated = await planGate(auth.user.id, "ai", "bulk");
  if (gated) return gated;

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  let body: { groups?: { images: InImage[] }[] };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const groups = body.groups ?? [];
  if (!Array.isArray(groups) || groups.length > 50) {
    return NextResponse.json({ error: "Send 1–50 items per request." }, { status: 400 });
  }
  for (const g of groups) {
    const bad = imageListError((g as { images?: unknown } | null)?.images, 24);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  }

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
  const connection = await requireEbayConnection(auth).catch(() => null);
  const runWithEbay = connection ? <T,>(fn: () => Promise<T>) => ebayContext.run(connection, fn) : null;

  for (let i = 0; i < groups.length; i++) {
    if (i >= processLimit) {
      results.push({ error: usage.message || AI_USAGE_LIMIT_MESSAGE });
      continue;
    }
    const timings: Record<string, number> = {};
    try {
      const images = await resolveImagesForOpenAI(groups[i].images ?? [], auth.user.id);
      const result = await analyzeGroup(apiKey, images, timings);
      const t = Date.now();
      const enriched = await enrichVisionResult(apiKey, result, runWithEbay);
      timings.enrichMs = Date.now() - t;
      // Per-stage timings: returned to the page and logged for Vercel logs.
      console.log(JSON.stringify({ event: "analyze_item", ...timings }));
      results.push({ ...enriched, timings });
    } catch (err) {
      results.push({ error: (err as Error).message, rateLimited: !!(err as { isRateLimit?: boolean }).isRateLimit, timings });
    }

  }

  return NextResponse.json({ results });
}
