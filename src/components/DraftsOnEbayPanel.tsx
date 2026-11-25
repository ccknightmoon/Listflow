"use client";

// Top of the Drafts screen: makes it obvious where each item lives.
//  * "Already on eBay?" -- Listflow drafts that match a live or scheduled
//    eBay listing (listed from the eBay app, or a publish whose link didn't
//    save). One tap moves them to Listings; nothing is deleted.
//  * "Scheduled on eBay" -- eBay's Scheduled list (made with "Finish on
//    eBay" here or scheduled in the eBay app). eBay has no API for the eBay
//    app's own Drafts tab, so Scheduled is the shared staging area both apps
//    can see and edit. Tap one to open it in Listflow's editor.
import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronRight, Link2, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/format";

export type ItemHome = "draft" | "scheduled" | "live";

const HOME_LABEL: Record<ItemHome, string> = {
  draft: "Listflow draft",
  scheduled: "Scheduled on eBay",
  live: "Live on eBay",
};

/** Small label saying where an item lives. */
export function HomeBadge({ home }: { home: ItemHome }) {
  const style =
    home === "live"
      ? { background: "var(--success-bg, rgba(34,197,94,.12))", color: "var(--success, #16a34a)" }
      : home === "scheduled"
        ? { background: "var(--warning-bg, rgba(234,179,8,.14))", color: "var(--text-primary)" }
        : { background: "var(--glass)", color: "var(--text-secondary)" };
  return (
    <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 shrink-0" style={style}>
      {HOME_LABEL[home]}
    </span>
  );
}

interface Match {
  draftId: string;
  draftTitle: string | null;
  listingId: string;
  listingTitle: string;
  status: "active" | "scheduled";
  reason: "sku" | "title";
  price: number | null;
}

interface Scheduled {
  listingId: string;
  title: string;
  price: number | null;
  thumbnail: string | null;
  startTime: string | null;
  draftId: string | null;
}

export default function DraftsOnEbayPanel({ onLinked }: { onLinked: (draftIds: string[]) => void }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [scheduled, setScheduled] = useState<Scheduled[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch<{ matches?: Match[] }>("/api/drafts/reconcile")
      .then((d) => { if (alive) setMatches(d.matches ?? []); })
      .catch(() => undefined); // optional helper: Drafts works without it
    apiFetch<{ items?: Scheduled[] }>("/api/ebay/scheduled")
      .then((d) => { if (alive) setScheduled(d.items ?? []); })
      .catch(() => { if (alive) setScheduled([]); });
    return () => { alive = false; };
  }, []);

  async function link(list: Match[]) {
    setBusy(list.length === 1 ? list[0].draftId : "all");
    setNote(null);
    try {
      const r = await apiFetch<{ linked?: string[]; skipped?: Array<{ draftId: string; reason: string }>; error?: string }>("/api/drafts/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: list.map((m) => ({ draftId: m.draftId, listingId: m.listingId })) }),
      });
      if (r.error) throw new Error(r.error);
      const done = r.linked ?? [];
      setMatches((prev) => prev.filter((m) => !done.includes(m.draftId)));
      if (done.length) onLinked(done);
      if (r.skipped?.length) setNote(r.skipped.map((s) => s.reason).join(" "));
      else setNote(`${done.length} moved to Listings.`);
      window.dispatchEvent(new Event("listflow:counts-changed"));
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const sched = scheduled ?? [];
  return (
    <div className="flex flex-col gap-3 mb-4">
      <p className="text-xs flex flex-wrap items-center gap-1.5" style={{ color: "var(--text-tertiary)" }}>
        <HomeBadge home="draft" /> only in Listflow, not on eBay yet.
        <span className="whitespace-nowrap">Listing one moves it to Listings.</span>
      </p>

      {matches.length > 0 && (
        <div className="card p-3 text-sm" style={{ borderColor: "var(--warning-border)", background: "var(--warning-bg)" }} role="status">
          <div className="flex items-start gap-2 mb-2">
            <Link2 className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="flex-1" style={{ color: "var(--text-primary)" }}>
              {matches.length === 1 ? "This draft looks like it's" : `${matches.length} drafts look like they're`} already on eBay. Move {matches.length === 1 ? "it" : "them"} to Listings so {matches.length === 1 ? "it isn't" : "they aren't"} listed twice.
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {matches.map((m) => (
              <li key={m.draftId} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium">{m.draftTitle ?? "Untitled"}</p>
                  <p className="text-xs truncate flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                    <HomeBadge home={m.status === "scheduled" ? "scheduled" : "live"} />
                    <a className="underline" href={`https://www.ebay.com/itm/${m.listingId}`} target="_blank" rel="noreferrer">#{m.listingId}</a>
                    {m.reason === "title" ? " · same title" : " · same SKU"}
                    {m.price != null ? ` · ${formatMoney(m.price)}` : ""}
                  </p>
                </div>
                <button className="btn text-xs" disabled={!!busy} onClick={() => link([m])}>
                  {busy === m.draftId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Move to Listings"}
                </button>
              </li>
            ))}
          </ul>
          {matches.length > 1 && (
            <button className="btn text-xs mt-2" disabled={!!busy} onClick={() => link(matches)}>
              {busy === "all" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : `Move all ${matches.length}`}
            </button>
          )}
        </div>
      )}
      {note && <p className="text-xs" role="status" style={{ color: "var(--text-secondary)" }}>{note}</p>}

      {sched.length > 0 && (
        <div className="card p-3">
          <button className="w-full flex items-center gap-2 text-sm font-semibold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <CalendarClock className="w-4 h-4" />
            <span className="flex-1 text-left">Scheduled on eBay ({sched.length})</span>
            <ChevronRight className={`w-4 h-4 transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
          <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
            Not live yet. Edit here or in the eBay app (Selling → Scheduled); changes show in both.
          </p>
          {open && (
            <ul className="flex flex-col gap-2 mt-3">
              {sched.map((i) => (
                <li key={i.listingId}>
                  <Link href={i.draftId ? `/drafts/${i.draftId}` : `/store/edit/${i.listingId}`} className="flex gap-3 items-center">
                    {i.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- eBay thumbnail
                      <img src={i.thumbnail} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" />
                    ) : <div className="w-11 h-11 rounded-lg shrink-0" style={{ background: "var(--glass)" }} />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{i.title}</p>
                      <p className="text-xs flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                        <HomeBadge home="scheduled" />
                        {i.startTime ? `goes live ${new Date(i.startTime).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}
                        {i.price != null ? ` · ${formatMoney(i.price)}` : ""}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
