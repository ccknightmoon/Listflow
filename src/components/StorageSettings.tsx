"use client";

// Settings → "Storage & pick list". OFF by default. Pick how you store
// stock; change it any time:
//   SKU boxes   -> boxes as SKU ranges, location worked out from the SKU
//   Bins/racks  -> type a location on each item
//   SKU only    -> no location, To-ship sorted by SKU
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Switch } from "@/components/AutomationSettings";
import { boxErrors, generateBoxes, STORAGE_DEFAULTS, type SkuBox, type StorageMode, type StorageSettings } from "@/lib/storage-locations";

interface Resp { available: boolean; settings: StorageSettings }

/** The seller's storage settings (null until loaded; OFF when unavailable). */
export function useStorageSettings(): StorageSettings | null {
  const [s, setS] = useState<StorageSettings | null>(null);
  useEffect(() => {
    apiFetch<Resp>("/api/settings/storage").then((r) => setS(r.settings ?? STORAGE_DEFAULTS), () => setS(STORAGE_DEFAULTS));
  }, []);
  return s;
}

const MODES: Array<{ id: StorageMode; label: string; help: string }> = [
  { id: "sku_boxes", label: "SKU boxes", help: "Boxes hold SKU ranges (e.g. Box 18 = SKU 1701–1800). The box is worked out from the SKU — nothing to type per item." },
  { id: "bins", label: "Bins / racks", help: "Type a location on each item (e.g. RACK B). Pick list sorted by location, then SKU." },
  { id: "sku_only", label: "SKU only", help: "No location. Pick list sorted by SKU." },
];

type Row = { name: string; from: string; to: string };
const toRows = (b: SkuBox[]): Row[] => b.map((x) => ({ name: x.name, from: String(x.from), to: String(x.to) }));
const toBoxes = (r: Row[]): SkuBox[] => r.map((x) => ({ name: x.name.trim(), from: Number(x.from), to: Number(x.to) }));

export function StorageSettingsView({ initial, available, onSave }: { initial: StorageSettings; available: boolean; onSave: (s: StorageSettings) => Promise<string | null> }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [mode, setMode] = useState<StorageMode>(initial.mode);
  const [rows, setRows] = useState<Row[]>(toRows(initial.boxes));
  const [gen, setGen] = useState({ start: "1", per: "100", count: "10", prefix: "Box" });
  const [msg, setMsg] = useState<string | null>(null);
  const boxes = toBoxes(rows);
  const errors = mode === "sku_boxes" && rows.length ? boxErrors(boxes) : [];
  const boxesDirty = JSON.stringify(boxes) !== JSON.stringify(initial.boxes);

  async function save(next: Partial<{ enabled: boolean; mode: StorageMode; boxes: SkuBox[] }>) {
    const value = { enabled: next.enabled ?? enabled, mode: next.mode ?? mode, boxes: next.boxes ?? (boxErrors(boxes).length ? initial.boxes : boxes) };
    const err = await onSave(value);
    setMsg(err ?? "Saved ✓");
    return !err;
  }

  if (!available) return <p className="text-xs" style={{ color: "var(--text-tertiary)" }} data-testid="storage-settings">Needs a one-time database update (migration 041). Until then it stays off and To-ship is sorted by SKU.</p>;

  return (
    <div className="flex flex-col gap-3 text-xs" data-testid="storage-settings">
      <div className="flex items-center gap-3">
        <p className="flex-1" style={{ color: "var(--text-secondary)" }}>
          {enabled ? "On — locations show on items and To-ship." : "Off — no location anywhere; To-ship sorted by SKU (99, 100, 1740…)."}
        </p>
        <Switch label="Storage & pick list" checked={enabled} onChange={async (v) => { const prev = enabled; setEnabled(v); if (!(await save({ enabled: v }))) setEnabled(prev); }} />
      </div>
      {enabled && (
        <>
          <div className="flex flex-col gap-1" role="radiogroup" aria-label="How you store items">
            {MODES.map((m) => (
              <label key={m.id} className="flex items-start gap-2 cursor-pointer">
                <input type="radio" name="storage-mode" className="mt-0.5" checked={mode === m.id} onChange={async () => { const prev = mode; setMode(m.id); if (!(await save({ mode: m.id }))) setMode(prev); }} />
                <span><strong>{m.label}</strong> <span style={{ color: "var(--text-tertiary)" }}>— {m.help}</span></span>
              </label>
            ))}
          </div>

          {mode === "sku_boxes" && (
            <div className="card p-3 flex flex-col gap-2" data-testid="sku-boxes">
              <p className="font-medium">Boxes</p>
              {rows.length === 0 && <p style={{ color: "var(--text-tertiary)" }}>No boxes yet. Add one, or generate a set below.</p>}
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input className="input py-1 flex-1 min-w-0" aria-label={`Box ${i + 1} name`} placeholder="Box 18" value={r.name} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                  <span>SKU</span>
                  <input className="input py-1 w-20" inputMode="numeric" aria-label={`Box ${i + 1} from SKU`} value={r.from} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, from: e.target.value.replace(/\D/g, "") } : x)))} />
                  <span>–</span>
                  <input className="input py-1 w-20" inputMode="numeric" aria-label={`Box ${i + 1} to SKU`} value={r.to} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, to: e.target.value.replace(/\D/g, "") } : x)))} />
                  <button type="button" className="p-1" aria-label={`Remove box ${i + 1}`} onClick={() => setRows(rows.filter((_, k) => k !== i))}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn text-xs py-1 px-2" onClick={() => {
                  const last = boxes[boxes.length - 1];
                  const from = last && Number.isInteger(last.to) ? last.to + 1 : 1;
                  setRows([...rows, { name: `Box ${rows.length + 1}`, from: String(from), to: String(from + 99) }]);
                }}><Plus className="w-3 h-3" /> Add box</button>
                <button type="button" className="btn btn-primary text-xs py-1 px-2" disabled={!boxesDirty || errors.length > 0} onClick={() => void save({ boxes })}>Save boxes</button>
              </div>
              {errors.length > 0 && <ul role="alert" style={{ color: "var(--danger)" }}>{errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>}
              <details>
                <summary className="cursor-pointer">Generate boxes</summary>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <label>Start SKU<input className="input py-1 w-full" inputMode="numeric" value={gen.start} onChange={(e) => setGen({ ...gen, start: e.target.value.replace(/\D/g, "") })} /></label>
                  <label>Items per box<input className="input py-1 w-full" inputMode="numeric" value={gen.per} onChange={(e) => setGen({ ...gen, per: e.target.value.replace(/\D/g, "") })} /></label>
                  <label>How many boxes<input className="input py-1 w-full" inputMode="numeric" value={gen.count} onChange={(e) => setGen({ ...gen, count: e.target.value.replace(/\D/g, "") })} /></label>
                  <label>Name prefix<input className="input py-1 w-full" value={gen.prefix} onChange={(e) => setGen({ ...gen, prefix: e.target.value })} /></label>
                </div>
                <button type="button" className="btn text-xs py-1 px-2 mt-2" onClick={() => {
                  const made = generateBoxes({ startSku: Number(gen.start), perBox: Number(gen.per), count: Number(gen.count), prefix: gen.prefix });
                  if (!made.length) { setMsg("Check the numbers (all whole numbers, at least 1)."); return; }
                  setRows(toRows(made));
                  setMsg(`Made ${made.length} boxes: ${made[0].name} = SKU ${made[0].from}–${made[0].to} … ${made[made.length - 1].name} = ${made[made.length - 1].from}–${made[made.length - 1].to}. Review, then Save boxes.`);
                }}>Fill the list (replaces it)</button>
              </details>
              <p style={{ color: "var(--text-tertiary)" }}>SKUs that aren&apos;t plain numbers, or fall outside every box, show as &ldquo;Unassigned&rdquo;.</p>
            </div>
          )}
        </>
      )}
      {msg && <p role="status" style={{ color: "var(--text-tertiary)" }}>{msg}</p>}
    </div>
  );
}

export default function StorageSettingsCard() {
  const [state, setState] = useState<Resp | null>(null);
  useEffect(() => {
    apiFetch<Resp>("/api/settings/storage").then(setState, () => setState({ available: false, settings: STORAGE_DEFAULTS }));
  }, []);
  if (!state) return <p className="text-xs">Loading…</p>;
  return (
    <StorageSettingsView
      initial={state.settings}
      available={state.available}
      onSave={async (s) => {
        try {
          await apiFetch("/api/settings/storage", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
          setState({ available: true, settings: s });
          return null;
        } catch (e) {
          return (e as Error).message || "Couldn't save.";
        }
      }}
    />
  );
}
