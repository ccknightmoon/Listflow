"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw, MessageCircle, Shirt, Send } from "lucide-react";
import Toast from "@/components/Toast";
import { apiFetch } from "@/lib/api";
import { getPageCache, setPageCache } from "@/lib/page-cache";

interface BuyerQuestion {
  messageId: string;
  senderId: string;
  subject: string;
  body: string;
  createdAt: string;
  itemId: string | null;
  title: string | null;
  thumbnail: string | null;
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

  useEffect(() => {
    load({ silent: getPageCache<BuyerQuestion[]>(MESSAGES_CACHE_KEY) !== undefined });
  }, []);

  // Mirror the list back into the cache so the next visit (within this
  // tab, before it backgrounds) can paint instantly.
  useEffect(() => { setPageCache(MESSAGES_CACHE_KEY, questions); }, [questions]);

  async function load(opts: { silent?: boolean } = {}) {
    if (!opts.silent) setLoading(true);
    setError(null);
    setNeedsConnect(false);
    setNeedsReconnect(false);
    try {
      const data = await apiFetch<{ questions?: BuyerQuestion[]; error?: string; connect?: boolean; reconnect?: boolean }>("/api/ebay/messages");
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
      setError("Failed to load buyer questions");
    } finally {
      setLoading(false);
    }
  }

  async function sendReply(q: BuyerQuestion) {
    const key = questionKey(q);
    const text = (replyText[key] ?? "").trim();
    if (!text) {
      setError("Write a reply before sending.");
      return;
    }
    if (!confirm(`Send this reply to ${q.senderId}? This can't be undone.`)) return;

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
    <main className="relative min-h-screen max-w-md mx-auto px-5 pt-6 pb-5 overflow-hidden" style={{ viewTransitionName: "messages-panel" }}>
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

      {loading && (
        <div className="card p-8 text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">Checking for buyer questions...</p>
        </div>
      )}

      {!loading && !error && questions.length === 0 && (
        <div className="card p-10 text-center">
          <MessageCircle className="w-8 h-8 mx-auto mb-3 text-[var(--text-tertiary)]" />
          <p className="text-sm font-medium mb-1">All caught up!</p>
          <p className="text-xs text-[var(--text-secondary)]">No unanswered buyer questions right now.</p>
        </div>
      )}

      {!loading && questions.length > 0 && (
        <div className="flex flex-col gap-2">
          {questions.map((q, i) => {
            const key = questionKey(q);
            const isReplying = replying.has(key);
            const isOpen = openKey === key;
            const text = replyText[key] ?? "";

            return (
              <div key={key} className={`card stagger p-3 ${i < 6 ? `d${i + 1}` : ""}`}>
                <div className="flex items-start gap-3">
                  {q.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={q.thumbnail}
                      alt={q.title ?? ""}
                      loading="lazy"
                      decoding="async"
                      className="w-12 h-12 rounded-md object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-md bg-[var(--bg-page)] flex items-center justify-center flex-shrink-0">
                      <Shirt className="w-5 h-5 text-[var(--text-secondary)]" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{q.title || "Your listing"}</p>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                      {q.senderId || "Unknown buyer"}{timeAgo(q.createdAt) ? ` · ${timeAgo(q.createdAt)}` : ""}
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
