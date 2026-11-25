// What each background job actually does. Server only. Every external
// dependency is injectable so the whole pipeline can be tested end to end
// with mocked AI / eBay / database.
import { isPrivatePhotoRef } from "@/lib/private-photos";
import { externalPhotoUrls, OPENAI_URL_TTL_S, resolveImagesForOpenAI } from "@/lib/private-photos-server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiResult } from "@/lib/ai-result";
import { currentConfidence } from "@/lib/ai-result";
import { analyzeAndEnrich, isOwnPhotoUrl } from "@/lib/analyze-core";
import { checkAndConsumeAiUsage, type UsageCheckResult } from "@/lib/ai-usage";
import { buildDraftPayload } from "@/lib/draft-payload";
import { draftRowFromBody, withoutMissingColumn } from "@/lib/draft-row";
import { ebayConnectionForUser } from "@/lib/ebay-connection";
import { ebayContext, type EbayConnectionContext } from "@/lib/ebay-request-context";
import { groupPhotosCore, type GroupChunkResult, type GroupImagePart } from "@/lib/group-photos-core";
import type { PriceSuggestion } from "@/lib/pricing";
import { computePriceSuggestion, type PriceInput } from "@/lib/pricing-suggest";
import { publishDraft, type PublishContext } from "@/lib/publish-draft";
import { MAX_ANALYSIS_PHOTOS } from "@/lib/photo-plan";
import { applyChunk, initialGroupingState, isGroupingDone, nextChunk, type GroupingState } from "./grouping-state";
import type { Job, JobKind, JobStore, NewJob, Outcome } from "./types";
import type { Processor, ProcessorContext } from "./worker";

export interface DraftWriter {
  /** Draft already made by this job (idempotency), or null. */
  findBySourceJob(jobId: string, userId: string): Promise<string | null>;
  /** Inserts the row with source_job_id = jobId; returns the id (existing one on a duplicate). */
  insert(jobId: string, row: Record<string, unknown>): Promise<string>;
}

export interface ProcessorDeps {
  apiKey: string | undefined;
  store: JobStore;
  drafts: DraftWriter;
  checkAiUsage(userId: string, amount: number): Promise<UsageCheckResult>;
  analyze: typeof analyzeAndEnrich;
  /** Private draft photo links -> signed URLs for OpenAI (identity when there are none). */
  resolveImages: (images: { url?: string }[], userId: string) => Promise<{ url?: string }[]>;
  price(input: PriceInput): Promise<PriceSuggestion>;
  fetchImageBase64(url: string, userId?: string): Promise<string | undefined>;
  ebayConnection(userId: string): Promise<EbayConnectionContext | null>;
  publish(ctx: Omit<PublishContext, "supabase">, draftId: string): Promise<{ status: number; json: Record<string, unknown> }>;
  groupChunk(apiKey: string, parts: GroupImagePart[]): Promise<GroupChunkResult>;
}

const errMsg = (e: unknown) => (e as Error)?.message || "Unexpected error";
const isRate = (e: unknown) => !!(e as { isRateLimit?: boolean })?.isRateLimit || /rate limit|429|too many requests/i.test(errMsg(e));

export function photoUrlsOf(input: Record<string, unknown>): string[] {
  const raw = Array.isArray(input.photoUrls) ? input.photoUrls : [];
  return raw.filter((u): u is string => typeof u === "string" && (isOwnPhotoUrl(u) || isPrivatePhotoRef(u)));
}

// ---------- analyze: photos -> AI (Pass A/B, category, specifics, title) -> price -> draft ----------
export async function processAnalyze(job: Job, ctx: ProcessorContext, deps: ProcessorDeps): Promise<Outcome> {
  const userId = job.user_id;
  // Idempotent: a draft made by an earlier (interrupted) run is reused.
  const existing = job.draft_id ?? (await deps.drafts.findBySourceJob(job.id, userId));
  if (existing) return { type: "done", draftId: existing, result: { ...(job.result ?? {}), analysis: undefined } };

  const urls = photoUrlsOf(job.input);
  if (urls.length === 0) return { type: "dead", error: "No uploaded photos for this item." };
  if (!deps.apiKey) return { type: "dead", error: "OPENAI_API_KEY is not configured on the server." };

  const r: Record<string, unknown> = { ...(job.result ?? {}) };
  if (!r.analysis) {
    const usage = await deps.checkAiUsage(userId, 1);
    if (!usage.allowed) return { type: "dead", error: usage.message };
    const conn = await deps.ebayConnection(userId).catch(() => null);
    const runWithEbay = conn ? <T,>(fn: () => Promise<T>) => ebayContext.run(conn, fn) : null;
    try {
      const images = await deps.resolveImages(urls.slice(0, MAX_ANALYSIS_PHOTOS).map((url) => ({ url })), userId);
      const { enriched, timings } = await deps.analyze(deps.apiKey, images, runWithEbay);
      r.analysis = enriched;
      r.timings = timings;
    } catch (e) {
      return { type: "retry", error: errMsg(e), rateLimited: isRate(e) };
    }
    // Checkpoint: a retry after this point never pays for the AI again.
    if (!(await ctx.checkpoint(r))) return { type: "retry", error: "Lost the job lease" };
  }
  const analysis = r.analysis as AiResult;

  if (r.pricing === undefined) {
    try {
      const image = await deps.fetchImageBase64(urls[0], userId).catch(() => undefined);
      r.pricing = await deps.price({
        title: analysis.suggestedTitle,
        brand: analysis.brand,
        condition: analysis.condition as PriceInput["condition"],
        image,
        itemType: analysis.itemType,
        size: analysis.size,
        shippingMode: "calculated",
      });
    } catch {
      r.pricing = null; // falls back to the built-in estimate, same as the browser
    }
    await ctx.checkpoint(r);
  }

  const payload = buildDraftPayload(analysis, r.pricing as PriceSuggestion | null, urls);
  let draftId: string;
  try {
    draftId = await deps.drafts.insert(job.id, draftRowFromBody(userId, payload));
  } catch (e) {
    return { type: "retry", error: `Saving the draft failed: ${errMsg(e)}` };
  }
  const conf = currentConfidence(analysis, urls.length);
  return {
    type: "done",
    draftId,
    result: {
      title: analysis.suggestedTitle ?? "",
      thumbnail: urls[0],
      price: payload.suggestedPrice,
      floor: payload.bestOfferFloor,
      ready: conf.ready,
      reasons: conf.reasons.filter((x) => x.blocking).map((x) => x.message).slice(0, 5),
      timings: r.timings,
    },
  };
}

// ---------- publish: one draft -> eBay ----------
export async function processPublish(job: Job, _ctx: ProcessorContext, deps: ProcessorDeps): Promise<Outcome> {
  const draftId = typeof job.input.draftId === "string" ? job.input.draftId : null;
  if (!draftId) return { type: "dead", error: "No draft to publish." };
  const connection = await deps.ebayConnection(job.user_id).catch(() => null);
  if (!connection) return { type: "dead", error: "eBay isn't connected. Connect it in Settings, then retry." };
  let res: { status: number; json: Record<string, unknown> };
  try {
    res = await deps.publish({ userId: job.user_id, connection }, draftId);
  } catch (e) {
    return { type: "retry", error: errMsg(e), rateLimited: isRate(e) };
  }
  const j = res.json;
  if (j.success) return { type: "done", draftId, result: { listingId: j.listingId ?? null, url: j.url ?? null, warning: j.storeCategoryWarning ?? null } };
  const error = typeof j.error === "string" && j.error ? j.error : `eBay listing failed (HTTP ${res.status}).`;
  if (j.connect || j.reconnect) return { type: "dead", error };
  // 4xx = something about the draft (missing price/photo, SKU clash): fix it, don't hammer eBay.
  if (res.status >= 400 && res.status < 500) return { type: "dead", error };
  return { type: "retry", error, rateLimited: isRate(error) };
}

// ---------- group: a whole batch of photos -> items, then one analyze job per item ----------
const CHUNK_MS_RESERVE = 20_000;

export async function processGroup(job: Job, ctx: ProcessorContext, deps: ProcessorDeps): Promise<Outcome> {
  const urls = photoUrlsOf(job.input);
  if (urls.length === 0) return { type: "dead", error: "No uploaded photos to group." };
  if (!deps.apiKey) return { type: "dead", error: "OPENAI_API_KEY is not configured on the server." };
  let state: GroupingState = (job.result?.grouping as GroupingState | undefined) ?? initialGroupingState();

  while (!isGroupingDone(state, urls.length)) {
    if (ctx.deadline - ctx.now() < CHUNK_MS_RESERVE) return { type: "continue", result: { grouping: state } };
    const usage = await deps.checkAiUsage(job.user_id, 1);
    if (!usage.allowed) return { type: "dead", error: usage.message, result: { grouping: state } };
    const chunk = nextChunk(state, urls.length);
    const chunkUrls = await deps.resolveImages(chunk.map((i) => ({ url: urls[i] })), job.user_id);
    const parts: GroupImagePart[] = chunkUrls.map((img) => ({ type: "image_url", image_url: { url: img.url as string, detail: "low" } }));
    let answer: GroupChunkResult;
    try {
      answer = await deps.groupChunk(deps.apiKey, parts);
    } catch (e) {
      // Keep what's done; the retry resumes from this chunk.
      await ctx.checkpoint({ grouping: state });
      return { type: "retry", error: errMsg(e), rateLimited: isRate(e) };
    }
    state = applyChunk(state, chunk, answer, urls.length);
    if (!(await ctx.checkpoint({ grouping: state }))) return { type: "retry", error: "Lost the job lease" };
  }

  // Hand each item to analysis. Idempotent: item keys are fixed per group.
  const items: NewJob[] = state.groups.map((g, i) => ({
    user_id: job.user_id,
    batch_id: job.batch_id,
    item_key: `g${String(i).padStart(4, "0")}`,
    kind: "analyze",
    input: { photoUrls: g.map((idx) => urls[idx]) },
  }));
  await deps.store.enqueue(items);
  return {
    type: "done",
    result: { items: items.length, autoPlaced: state.autoPlaced.length, unusable: state.unusable },
  };
}

export function makeProcessors(deps: ProcessorDeps): Record<JobKind, Processor> {
  return {
    analyze: (job, ctx) => processAnalyze(job, ctx, deps),
    publish: (job, ctx) => processPublish(job, ctx, deps),
    group: (job, ctx) => processGroup(job, ctx, deps),
  };
}

// ---------- production wiring ----------
export function supabaseDraftWriter(db: SupabaseClient): DraftWriter {
  return {
    async findBySourceJob(jobId, userId) {
      const { data } = await db.from("drafts").select("id").eq("source_job_id", jobId).eq("user_id", userId).maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },
    async insert(jobId, row) {
      let withJob: Record<string, unknown> = { ...row, source_job_id: jobId };
      let { data, error } = await db.from("drafts").insert([withJob]).select("id");
      // Migrations 027/035 not applied yet: save the rest.
      for (let tries = 0; error && tries < 2; tries++) {
        const rest = withoutMissingColumn(withJob, error);
        if (!rest) break;
        withJob = rest;
        ({ data, error } = await db.from("drafts").insert([withJob]).select("id"));
      }
      if (error?.code === "23505") {
        // Another run already made it (unique source_job_id): use that one.
        const again = await db.from("drafts").select("id").eq("source_job_id", jobId).eq("user_id", row.user_id as string).maybeSingle();
        if (again.data?.id) return again.data.id as string;
      }
      if (error) throw new Error(error.message);
      return data![0].id as string;
    },
  };
}

/** Fetches one of OUR stored photos as base64 (for eBay image search). */
export async function fetchOwnPhotoBase64(url: string, userId?: string): Promise<string | undefined> {
  if (isPrivatePhotoRef(url)) {
    if (!userId) return undefined;
    [url] = await externalPhotoUrls([url], OPENAI_URL_TTL_S, userId);
    if (!url) return undefined;
  }
  if (!isOwnPhotoUrl(url)) return undefined;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return undefined;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 4_000_000 ? undefined : buf.toString("base64");
}

export function productionDeps(db: SupabaseClient, store: JobStore): ProcessorDeps {
  return {
    apiKey: process.env.OPENAI_API_KEY,
    store,
    drafts: supabaseDraftWriter(db),
    checkAiUsage: checkAndConsumeAiUsage,
    analyze: analyzeAndEnrich,
    resolveImages: (images, userId) => resolveImagesForOpenAI(images, userId),
    price: computePriceSuggestion,
    fetchImageBase64: fetchOwnPhotoBase64,
    ebayConnection: (userId) => ebayConnectionForUser(db, userId),
    async publish(ctx, draftId) {
      const res = await publishDraft({ ...ctx, supabase: db }, { draftId });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    },
    groupChunk: groupPhotosCore,
  };
}
