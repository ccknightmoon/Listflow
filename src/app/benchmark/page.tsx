"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2, Play, Square } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { aggregate, BENCH_FIELDS, type BenchmarkReport, type ItemScore } from "@/lib/benchmark";

interface Row {
  itemId: string;
  model?: string;
  skipped?: string;
  error?: string;
  gold?: { title: string; categoryPath: string; specifics: Record<string, string[]> };
  pred?: { title: string; categoryPath: string | null; specifics: Record<string, string[]>; ready: boolean };
  score?: ItemScore;
}

/**
 * Accuracy benchmark (read-only): runs the listing AI on photos of Sel's
 * own live listings and compares with Sel's hand-made title, category and
 * specifics. Nothing on eBay is changed. Each item costs one AI analysis.
 */
export default function BenchmarkPage() {
  const [n, setN] = useState(40);
  const [model, setModel] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const stop = useRef(false);

  const scores = rows.map((r) => r.score).filter((s): s is ItemScore => !!s);
  const report: BenchmarkReport | null = scores.length ? aggregate(scores) : null;

  async function run() {
    stop.current = false;
    setRunning(true);
    setRows([]);
    try {
      setStatus("Picking listings…");
      const s = await apiFetch<{ ids: string[]; total: number }>(`/api/benchmark/sample?n=${n}`);
      let i = 0;
      const out: Row[] = [];
      async function worker() {
        while (i < s.ids.length && !stop.current) {
          const id = s.ids[i++];
          setStatus(`Analyzing ${out.length + 1} of ${s.ids.length} (from ${s.total} active listings)…`);
          const r = await apiFetch<Row>("/api/benchmark/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: id, model: model || undefined }) }).catch((e) => ({ itemId: id, error: (e as Error).message }));
          out.push(r);
          setRows([...out]);
        }
      }
      await Promise.all([worker(), worker()]);
      setStatus(stop.current ? "Stopped." : "Done.");
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify({ model: model || "default", report, rows }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `listflow-benchmark-${new Date().toISOString().slice(0, 10)}${model ? `-${model}` : ""}.json`;
    a.click();
  }

  return (
    <main className="min-h-screen max-w-md lg:max-w-[1360px] mx-auto px-5 lg:px-8 pt-6 lg:pt-8 pb-16">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/settings" className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center" style={{ background: "var(--glass)", border: "1px solid var(--glass-line)" }} aria-label="Back"><ArrowLeft className="w-4 h-4" /></Link>
        <div>
          <h1 className="text-xl font-medium">Listing accuracy benchmark</h1>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Read-only: compares the AI with your own live listings. Nothing on eBay changes.</p>
        </div>
      </div>

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs" style={{ color: "var(--text-secondary)" }}>Listings to test
          <input className="input w-24 mt-1" inputMode="numeric" value={n} onChange={(e) => setN(Math.max(1, Math.min(60, Number(e.target.value.replace(/\D/g, "")) || 1)))} />
        </label>
        <label className="text-xs" style={{ color: "var(--text-secondary)" }}>Vision model (blank = app default)
          <input className="input w-48 mt-1" placeholder="e.g. gpt-4o" value={model} onChange={(e) => setModel(e.target.value.trim())} />
        </label>
        {running ? (
          <button type="button" className="btn" onClick={() => { stop.current = true; }}><Square className="w-4 h-4" /> Stop</button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void run()}><Play className="w-4 h-4" /> Run benchmark</button>
        )}
        {rows.length > 0 && !running && <button type="button" className="btn" onClick={download}><Download className="w-4 h-4" /> Download results</button>}
        <p className="text-xs w-full flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>{running && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{status}</p>
      </div>

      {report && (
        <div className="grid lg:grid-cols-3 gap-4 mb-4">
          <div className="card p-4 text-sm">
            <p className="font-semibold mb-2">Summary ({report.items} listings)</p>
            <p>Category exact: <b>{report.categoryExact}%</b> · same branch: <b>{report.categoryBranch}%</b></p>
            <p>Field accuracy (all fields): <b>{report.overallFieldAccuracy ?? "—"}%</b></p>
            <p>Required specifics complete: <b>{report.requiredComplete}%</b></p>
            <p>Title quality: <b>{report.titleScore}/100</b></p>
            <p>Marked Ready: <b>{report.ready}%</b>{report.readyPrecision != null && <> · Ready and right: <b>{report.readyPrecision}%</b></>}</p>
          </div>
          <div className="card p-4 text-sm">
            <p className="font-semibold mb-2">By field</p>
            {BENCH_FIELDS.map((f) => (
              <p key={f} className="flex justify-between"><span>{f}</span><span className="tabular-nums">{report.fieldAccuracy[f].accuracy ?? "—"}{report.fieldAccuracy[f].accuracy != null ? "%" : ""} <span style={{ color: "var(--text-tertiary)" }}>({report.fieldAccuracy[f].compared})</span></span></p>
            ))}
          </div>
          <div className="card p-4 text-sm">
            <p className="font-semibold mb-2">Top errors</p>
            {report.topErrors.map((e) => <p key={e.error} className="flex justify-between"><span>{e.error}</span><span>{e.count}</span></p>)}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.itemId} className="card p-3 text-xs">
            <p className="font-semibold">#{r.itemId} {r.skipped && `— skipped: ${r.skipped}`}{r.error && <span style={{ color: "var(--danger)" }}> — {r.error}</span>}</p>
            {r.gold && r.pred && (
              <div className="grid lg:grid-cols-2 gap-2 mt-1">
                <div><p style={{ color: "var(--text-tertiary)" }}>Yours</p><p>{r.gold.title}</p><p style={{ color: "var(--text-tertiary)" }}>{r.gold.categoryPath}</p></div>
                <div><p style={{ color: "var(--text-tertiary)" }}>AI {r.pred.ready ? "· Ready" : "· Needs a look"}</p><p>{r.pred.title}</p><p style={{ color: "var(--text-tertiary)" }}>{r.pred.categoryPath}</p></div>
              </div>
            )}
            {r.score && r.score.errors.length > 0 && <p className="mt-1" style={{ color: "var(--danger)" }}>{r.score.errors.join(" · ")}</p>}
          </div>
        ))}
      </div>
    </main>
  );
}
