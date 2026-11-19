// App-wide background publishing queue. Items are already-saved drafts, so
// nothing is ever lost: if the app is closed mid-queue, unpublished items
// simply stay in Drafts. While Listflow is open, publishing keeps going as
// the seller moves between pages (module state survives client-side
// navigation) and the PublishTray shows progress on every page.
//
// Publishing reuses POST /api/ebay/list, which is idempotent (a draft that
// already has a live listing returns it instead of listing twice).

export type PublishStatus = "queued" | "listing" | "listed" | "failed";

export type QueueKind = "publish" | "price";

export interface PublishItem {
  /** draft id for publishes; any unique id for other tasks */
  draftId: string;
  kind?: QueueKind;
  /** Custom task (e.g. a price change). Publishes use the queue's publisher. */
  run?: () => Promise<ListResponse>;
  /** Short result line, e.g. "$27.99 → $23.79" */
  note?: string;
  title: string;
  thumbnail: string | null;
  status: PublishStatus;
  error?: string;
  url?: string | null;
  needsConnect?: boolean;
  needsReconnect?: boolean;
  addedAt: number;
  /** When this run started / finished (ms) -- for the batch timing panel. */
  startedAt?: number;
  finishedAt?: number;
}

export interface ListResponse {
  success?: boolean;
  error?: string;
  connect?: boolean;
  reconnect?: boolean;
  url?: string | null;
}

export type Publisher = (draftId: string) => Promise<ListResponse>;

export const PUBLISH_CONCURRENCY = 2;

export function createPublishQueue(publish: Publisher, concurrency = PUBLISH_CONCURRENCY) {
  let items: PublishItem[] = [];
  let running = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const update = (draftId: string, patch: Partial<PublishItem>) => {
    items = items.map((i) => (i.draftId === draftId ? { ...i, ...patch } : i));
    emit();
  };

  async function runOne(item: PublishItem) {
    running++;
    update(item.draftId, { status: "listing", error: undefined, startedAt: Date.now(), finishedAt: undefined });
    try {
      const r = await (item.run ? item.run() : publish(item.draftId));
      if (r.error || r.connect || r.reconnect) {
        update(item.draftId, { status: "failed", error: r.error ?? "eBay didn't accept this listing.", needsConnect: !!r.connect, needsReconnect: !!r.reconnect, finishedAt: Date.now() });
      } else {
        update(item.draftId, { status: "listed", url: r.url ?? null, finishedAt: Date.now() });
        if (typeof window !== "undefined") window.dispatchEvent(new Event("listflow:counts-changed"));
      }
    } catch (e) {
      update(item.draftId, { status: "failed", error: (e as Error).message || "Network error — tap retry.", finishedAt: Date.now() });
    } finally {
      running--;
      pump();
    }
  }

  function pump() {
    while (running < concurrency) {
      const next = items.find((i) => i.status === "queued");
      if (!next) return;
      void runOne(next);
    }
  }

  return {
    enqueue(input: { draftId: string; title: string; thumbnail?: string | null }) {
      const existing = items.find((i) => i.draftId === input.draftId);
      if (existing && existing.status !== "failed") return; // already queued/listing/listed
      items = [
        ...items.filter((i) => i.draftId !== input.draftId),
        { draftId: input.draftId, title: input.title || "Untitled", thumbnail: input.thumbnail ?? null, status: "queued", addedAt: Date.now() },
      ];
      emit();
      pump();
    },
    /** Queue any background task (shown in the same tray). */
    enqueueTask(input: { id: string; title: string; thumbnail?: string | null; kind: QueueKind; note?: string; run: () => Promise<ListResponse> }) {
      const existing = items.find((i) => i.draftId === input.id);
      if (existing && (existing.status === "queued" || existing.status === "listing")) return;
      items = [
        ...items.filter((i) => i.draftId !== input.id),
        { draftId: input.id, title: input.title || "Untitled", thumbnail: input.thumbnail ?? null, kind: input.kind, note: input.note, run: input.run, status: "queued", addedAt: Date.now() },
      ];
      emit();
      pump();
    },
    retry(draftId: string) {
      const it = items.find((i) => i.draftId === draftId);
      if (!it || it.status !== "failed") return;
      update(draftId, { status: "queued", error: undefined });
      pump();
    },
    clearFinished() {
      items = items.filter((i) => i.status === "queued" || i.status === "listing");
      emit();
    },
    getItems: () => items,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

export type PublishQueue = ReturnType<typeof createPublishQueue>;

// The app's single queue (browser only).
let appQueue: PublishQueue | null = null;
export function getPublishQueue(): PublishQueue {
  if (!appQueue) {
    appQueue = createPublishQueue(async (draftId) => {
      const res = await fetch("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      let data: ListResponse = {};
      try { data = (await res.json()) as ListResponse; } catch { /* non-JSON */ }
      if (!res.ok && !data.error) data.error = `eBay listing failed (HTTP ${res.status}).`;
      return data;
    });
  }
  return appQueue;
}

export function summarizeQueue(items: PublishItem[], kind?: QueueKind) {
  if (kind) items = items.filter((i) => (i.kind ?? "publish") === kind);
  const total = items.length;
  const listed = items.filter((i) => i.status === "listed").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const active = items.filter((i) => i.status === "queued" || i.status === "listing").length;
  return { total, listed, failed, active, done: listed + failed };
}
