// Per-stage timing for one Batch Upload run, so the first real batch gives
// measured numbers instead of estimates. Kept as plain data + pure
// functions (no React) so it is easy to test and to copy out as text.

export const STAGES = ["compress", "upload", "grouping", "analysis", "pricing", "save", "publish"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  compress: "Compress photos",
  upload: "Upload photos",
  grouping: "Group into items",
  analysis: "AI analysis",
  pricing: "Price comps",
  save: "Save drafts",
  publish: "Publish to eBay",
};

export interface StageTiming {
  firstStart: number | null;
  lastEnd: number | null;
  /** Sum of every span's length (work time, overlapping spans add up). */
  busyMs: number;
  count: number;
}

/** Server-side breakdown returned with each analyzed item. */
export interface ItemServerTiming {
  tagFinderMs?: number;
  visionMs?: number;
  enrichMs?: number;
  totalMs?: number;
  photos?: number;
  highDetail?: number;
}

export interface BatchTimings {
  startedAt: number;
  stages: Record<Stage, StageTiming>;
  items: ItemServerTiming[];
  photos: number;
  retries: number;
}

export function newTimings(now = Date.now()): BatchTimings {
  const stages = {} as Record<Stage, StageTiming>;
  for (const s of STAGES) stages[s] = { firstStart: null, lastEnd: null, busyMs: 0, count: 0 };
  return { startedAt: now, stages, items: [], photos: 0, retries: 0 };
}

export function recordSpan(t: BatchTimings, stage: Stage, start: number, end: number, count = 1): void {
  const s = t.stages[stage];
  const ms = Math.max(0, end - start);
  s.busyMs += ms;
  s.count += count;
  s.firstStart = s.firstStart === null ? start : Math.min(s.firstStart, start);
  s.lastEnd = s.lastEnd === null ? end : Math.max(s.lastEnd, end);
}

/** Times an async step and records it, even if it throws. */
export async function timed<T>(t: BatchTimings | null, stage: Stage, fn: () => Promise<T>, count = 1): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    if (t) recordSpan(t, stage, start, Date.now(), count);
  }
}

export function recordItemServer(t: BatchTimings, timing: ItemServerTiming | undefined): void {
  if (timing && typeof timing === "object") t.items.push(timing);
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const p90 = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
};

export interface StageRow {
  stage: Stage;
  label: string;
  wallMs: number;
  avgMs: number | null;
  count: number;
}

export function summarize(t: BatchTimings) {
  const rows: StageRow[] = STAGES.filter((s) => t.stages[s].count > 0).map((s) => {
    const st = t.stages[s];
    return {
      stage: s,
      label: STAGE_LABELS[s],
      wallMs: st.firstStart !== null && st.lastEnd !== null ? st.lastEnd - st.firstStart : 0,
      avgMs: st.count ? Math.round(st.busyMs / st.count) : null,
      count: st.count,
    };
  });
  const pick = (k: keyof ItemServerTiming) =>
    t.items.map((i) => i[k]).filter((v): v is number => typeof v === "number");
  const server = {
    items: t.items.length,
    avgVisionMs: avg(pick("visionMs")),
    p90VisionMs: p90(pick("visionMs")),
    avgTagFinderMs: avg(pick("tagFinderMs")),
    avgEnrichMs: avg(pick("enrichMs")),
    avgPhotos: avg(pick("photos")),
    avgHighDetail: avg(pick("highDetail")),
  };
  const ends = rows.map((r) => t.stages[r.stage].lastEnd ?? 0);
  const totalMs = ends.length ? Math.max(...ends) - t.startedAt : 0;
  return { rows, server, totalMs, photos: t.photos, retries: t.retries };
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "–";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 90) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/** Plain-text report for the "Copy timings" button. */
export function formatReport(t: BatchTimings): string {
  const sum = summarize(t);
  const lines = [
    `Listflow batch timings (${new Date(t.startedAt).toISOString()})`,
    `Photos: ${sum.photos} · Items analyzed: ${sum.server.items} · Retries after rate limits: ${sum.retries}`,
    `Total so far: ${fmtMs(sum.totalMs)}`,
    "",
    ...sum.rows.map((r) => `${r.label}: ${fmtMs(r.wallMs)} wall · ${r.count} done · avg ${fmtMs(r.avgMs)} each`),
  ];
  if (sum.server.items) {
    lines.push(
      "",
      `Server, per item: vision avg ${fmtMs(sum.server.avgVisionMs)} (p90 ${fmtMs(sum.server.p90VisionMs)}), tag finder avg ${fmtMs(sum.server.avgTagFinderMs)}, enrich avg ${fmtMs(sum.server.avgEnrichMs)}, photos avg ${sum.server.avgPhotos ?? "–"} (${sum.server.avgHighDetail ?? "–"} full detail)`
    );
  }
  return lines.join("\n");
}
