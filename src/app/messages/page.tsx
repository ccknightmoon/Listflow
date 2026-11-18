"use client";

import { formatMoney } from "@/lib/format";
import { ListSkeleton } from "@/components/ui";
import { confirmAction } from "@/lib/confirm";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw, MessageCircle, Shirt, Send } from "lucide-react";
import Toast from "@/components/Toast";
import { apiFetch } from "@/lib/api";
import { getPageCache, setPageCache } from "@/lib/page-cache";
import { useIsDesktop } from "@/lib/use-is-desktop";

interface BuyerQuestion {
  messageId: string;
  senderId: string;
  subject: string;
  body: string;
  createdAt: string;
  itemId: string | null;
  title: string | null;
  thumbnail: string | null;
  price?: number | null;
  url?: string | null;
  context?: "listing" | "order" | "general";
}

const MAX_REPLY_LEN = 2000; // Matches eBay's own limit on a reply's Body field.

function questionKey(q: BuyerQuestion): string {
  return q.messageId;
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// See src/lib/page-cache.ts — shows the last-loaded questions list
// instantly on revisit while load() quietly refreshes it in the background.
const MESSAGES_CACHE_KEY = "messages:questions";

export default function MessagesPage() {
  const [questions, setQuestions] = useState<BuyerQuestion[]>(() => getPageCache<BuyerQuestion[]>(MESSAGES_CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(() => getPageCache<BuyerQuestion[]>(MESSAGES_CACHE_KEY) === undefined);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [replying, setReplying] = useState<Set<string>>(new Set());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  // Desktop (lg): list on the left, the selected question + reply on the right.
  const isDesktop = useIsDesktop();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Guards against out-of-order responses: the silent load fired on mount
  // and a manual refresh-button click can now overlap (e.g. tapping
  // refresh right after landing on a cached page). Each load() call stamps
  // its own id here; if a response comes back after a newer call has
  // already started, it's discarded instead of overwriting fresher state
  // or clearing the loading spinner out from under a request that's still
  // in flight.
  const loadIdRef = useRef(0);

  useEffect(() => {
    load({ silent: getPageCache<BuyerQuestion[]>(MESSAGES_CACHE_KEY) !== undefined });
  }, []);

  // Mirror the list back into the cache so the next visit (within this
  // tab, before it backgrounds) can paint instantly.
  useEffect(() => { setPageCache(MESSAGES_CACHE_KEY, questions); }, [questions]);

  async function load(opts: { silent?: boolean } = {}) {
    const requestId = ++loadIdRef.current;
    if (!opts.silent) setLoading(true);
    setError(null);
    setNeedsConnect(false);
    setNeedsReconnect(false);
    try {
      const data = await apiFetch<{ questions?: BuyerQuestion[]; error?: string; connect?: boolean; reconnect?: boolean }>("/api/ebay/messages");
      // A newer load() call started while this one was in flight -- let
      // that one's result stand instead of this (now stale) response.
      if (requestId !== loadIdRef.current) return;
      if (data.error) {
        setError(data.error);
        setNeedsConnect(!!data.connect);
        setNeedsReconnect(!!data.reconnect);
        // Don't clear the list on a transient error -- this branch also
        // fires for routine eBay hiccups (not just a real disconnect), and
        // load() runs silently on every revisit within the page-cache
        // window (src/lib/page-cache.ts). Wiping a good cached list the
        // moment a background refresh hits a blip would make a passing
        // eBay error look worse than doing nothing at all -- same
        // "fall back to what we already had" reasoning store/page.tsx
        // uses for its own eBay failures.
        return;
      }
      setQuestions(data.questions ?? []);
    } catch {
      if (requestId !== loadIdRef.current) return;
      setError("Failed to load buyer questions");
    } finally {
      if (requestId === loadIdRef.current) setLoading(false);
    }
  }

  async function sendReply(q: BuyerQuestion) {
    const key = questionKey(q);
    const text = (replyText[key] ?? "").trim();
    if (!text) {
      setError("Write a reply before sending.");
      return;
    }
    if (!(await confirmAction({ title: "Send this reply?", message: `To ${q.senderId}. This can't be undone.`, confirmLabel: "Send" }))) return;

    setReplying((prev) => new Set(prev).add(key));
    setError(null);
    try {
      const data = await apiFetch<{ error?: string; success?: boolean }>("/api/ebay/messages/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: q.messageId,
          senderId: q.senderId,
          itemId: q.itemId,
          body: text,
          displayToPublic: false,
        }),
      });
      if (data.error) throw new Error(data.error);
      setQuestions((prev) => prev.filter((item) => questionKey(item) !== key));
      setOpenKey((k) => (k === key ? null : k));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReplying((prev) => { const next = new Set(prev); next.delete(key); return next; });
    }
  }

  return (
    <main className="relative min-h-screen max-w-md lg:max-w-[1360px] mx-auto px-5 lg:px-8 pt-6 lg:pt-8 pb-8 overflow-hidden" style={{ viewTransitionName: "messages-panel" }}>
      <div
        className="bloom d1 stagger"
        style={{ width: 240, height: 240, top: -70, left: -60, background: "var(--glow-primary)" }}
      />
      <div
        className="bloom d1 stagger"
        style={{ width: 200, height: 200, top: 10, right: -70, background: "var(--glow-secondary)" }}
      />

      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/store"
          className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center flex-none"
          style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-medium">Buyer questions</h1>
          {!loading && !error && (
            <p className="text-xs text-[var(--text-secondary)]">
              {questions.length === 0
                ? "No unanswered questions"
                : `${questions.length} question${questions.length !== 1 ? "s" : ""} waiting on a reply`}
            </p>
          )}
        </div>
        <button
          onClick={() => load()}
          disabled={loading}
          aria-label="Refresh questions"
          title="Refresh questions"
          className="p-2 rounded-lg hover:bg-[var(--bg-page)] transition-colors"
        >
          {loading
            ? <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
            : <RefreshCw className="w-4 h-4 text-[var(--text-secondary)]" />
          }
        </button>
      </div>

      <Toast
        type="error"
        message={
          error ? (
            <>
              {error}
              {needsConnect && (
                <a href="/api/ebay/connect" className="underline ml-2 font-medium">Connect eBay →</a>
              )}
              {needsReconnect && (
                <a href="/api/ebay/connect" className="underline ml-2 font-medium">Reconnect eBay →</a>
              )}
            </>
          ) : null
        }
        onClose={() => setError(null)}
      />

      {loading && <ListSkeleton label="Checking for buyer questions…" />}

      {!loading && !error && questions.length === 0 && (
        <div className="card p-10 text-center">
          <MessageCircle className="w-8 h-8 mx-auto mb-3 text-[var(--text-tertiary)]" />
          <p className="text-sm font-medium mb-1">All caught up!</p>
          <p className="text-xs text-[var(--text-secondary)]">No unanswered buyer questions right now.</p>
        </div>
      )}

      {!loading && questions.length > 0 && isDesktop && (() => {
        const active = questions.find((q) => questionKey(q) === activeKey) ?? questions[0];
        const key = questionKey(active);
        const text = replyText[key] ?? "";
        const isReplying = replying.has(key);
        return (
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 items-start">
            <div role="listbox" aria-label="Buyer questions" className="card p-1.5 flex flex-col gap-0.5 max-h-[calc(100vh-180px)] overflow-y-auto"
              onKeyDown={(e) => {
                if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                e.preventDefault();
                const i = questions.findIndex((q) => questionKey(q) === key);
                const next = questions[Math.max(0, Math.min(questions.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
                setActiveKey(questionKey(next));
                (e.currentTarget.querySelector(`[data-qkey="${CSS.escape(questionKey(next))}"]`) as HTMLElement | null)?.focus();
              }}>
              {questions.map((q) => {
                const k = questionKey(q);
                const sel = k === key;
                return (
                  <button key={k} type="button" role="option" aria-selected={sel} data-qkey={k} tabIndex={sel ? 0 : -1}
                    onClick={() => setActiveKey(k)}
                    className="text-left rounded-xl px-3 py-2.5 flex items-start gap-3 hover:bg-[var(--glass)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                    style={{ background: sel ? "var(--accent-tint)" : undefined }}>
                    {q.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={q.thumbnail} alt="" loading="lazy" className="w-10 h-10 rounded-md object-cover flex-none" />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-[var(--bg-page)] flex items-center justify-center flex-none"><MessageCircle className="w-4 h-4 text-[var(--text-secondary)]" /></div>
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{q.title || (q.context === "general" ? "General message" : "Listing")}</span>
                      <span className="block text-xs truncate" style={{ color: "var(--text-secondary)" }}>{q.senderId || "Unknown buyer"}{timeAgo(q.createdAt) ? ` · ${timeAgo(q.createdAt)}` : ""}</span>
                      <span className="block text-xs truncate mt-0.5" style={{ color: "var(--text-tertiary)" }}>{q.body || q.subject}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="card p-5 lg:sticky lg:top-6">
              <div className="flex items-start gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  {active.url ? (
                    <a href={active.url} target="_blank" rel="noopener noreferrer" className="text-base font-semibold hover:text-[var(--accent)]">{active.title || "Listing"}</a>
                  ) : (
                    <p className="text-base font-semibold">General message</p>
                  )}
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {active.context === "order" ? "About their order · " : ""}{active.senderId || "Unknown buyer"}{timeAgo(active.createdAt) ? ` · ${timeAgo(active.createdAt)}` : ""}
                    {active.price != null ? ` · ${formatMoney(active.price)}` : ""}
                  </p>
                </div>
              </div>
              <p className="text-sm whitespace-pre-wrap mb-4">{active.body || active.subject || "(no message text)"}</p>
              <textarea
                value={text}
                onChange={(e) => setReplyText((prev) => ({ ...prev, [key]: e.target.value.slice(0, MAX_REPLY_LEN) }))}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim() && !isReplying) { e.preventDefault(); void sendReply(active); } }}
                placeholder="Write your reply…"
                aria-label={`Reply to ${active.senderId || "buyer"}`}
                rows={5}
                className="input w-full text-sm resize-y"
                disabled={isReplying}
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{text.length}/{MAX_REPLY_LEN} · ⌘/Ctrl+Enter to send</span>
                <button onClick={() => sendReply(active)} disabled={isReplying || !text.trim()} className="btn btn-primary text-sm px-4">
                  {isReplying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send reply
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {!loading && questions.length > 0 && !isDesktop && (
        <div className="flex flex-col gap-2">
          {questions.map((q, i) => {
            const key = questionKey(q);
            const isReplying = replying.has(key);
            const isOpen = openKey === key;
            const text = replyText[key] ?? "";

            return (
              <div key={key} className={`card stagger p-3 ${i < 6 ? `d${i + 1}` : ""}`}>
                <div className="flex items-start gap-3">
                  {(() => {
                    const thumb = q.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={q.thumbnail} alt="" loading="lazy" decoding="async" width={48} height={48} className="w-12 h-12 rounded-md object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-md bg-[var(--bg-page)] flex items-center justify-center flex-shrink-0">
                        {q.context === "general" ? <MessageCircle className="w-5 h-5 text-[var(--text-secondary)]" /> : <Shirt className="w-5 h-5 text-[var(--text-secondary)]" />}
                      </div>
                    );
                    return q.url ? <a href={q.url} target="_blank" rel="noopener noreferrer" aria-label="Open listing on eBay">{thumb}</a> : thumb;
                  })()}

                  <div className="flex-1 min-w-0">
                    {q.url ? (
                      <a href={q.url} target="_blank" rel="noopener noreferrer" className="flex items-baseline gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">{q.title || "Listing"}</span>
                        {q.price != null && <span className="text-xs font-semibold tabular-nums flex-none" style={{ color: "var(--text-secondary)" }}>{formatMoney(q.price)}</span>}
                      </a>
                    ) : (
                      <p className="text-sm font-medium truncate">General message</p>
                    )}
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                      {q.context === "order" ? "About their order · " : ""}{q.senderId || "Unknown buyer"}{timeAgo(q.createdAt) ? ` · ${timeAgo(q.createdAt)}` : ""}
                    </p>
                    <p className="text-sm mt-1.5">{q.body || q.subject || "(no message text)"}</p>
                  </div>
                </div>

                {!isOpen ? (
                  <button
                    onClick={() => setOpenKey(key)}
                    disabled={isReplying}
                    className="w-full flex items-center justify-center gap-1 text-xs font-medium py-2 tap rounded-lg mt-3"
                    style={{ background: "var(--glass)", border: "1px solid var(--glass-line)", color: "var(--text-primary)" }}
                  >
                    <Send className="w-3.5 h-3.5" /> Reply
                  </button>
                ) : (
                  <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                    <textarea
                      value={text}
                      onChange={(e) => setReplyText((prev) => ({ ...prev, [key]: e.target.value.slice(0, MAX_REPLY_LEN) }))}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim() && !isReplying) { e.preventDefault(); void sendReply(q); } }}
                      placeholder="Write your reply..."
                      rows={3}
                      className="input w-full text-sm resize-none"
                      disabled={isReplying}
                    />
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[11px] text-[var(--text-tertiary)]">{text.length}/{MAX_REPLY_LEN}</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setOpenKey(null)}
                          disabled={isReplying}
                          className="text-xs font-medium px-3 py-2 tap rounded-lg"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => sendReply(q)}
                          disabled={isReplying || !text.trim()}
                          className="text-xs font-medium px-3 py-2 tap rounded-lg flex items-center gap-1"
                          style={{ background: "var(--accent)", color: "#fff" }}
                        >
                          {isReplying && <Loader2 className="w-3 h-3 animate-spin" />}
                          Send
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
