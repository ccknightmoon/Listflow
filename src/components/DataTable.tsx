"use client";

import { useRef, useState, type ReactNode } from "react";
import { Z } from "@/lib/z-layers";
import { rowKeyAction, moveRowIndex, rangeIds } from "@/lib/row-keys";
import { RowMenu, RowMenuButton, type RowAction } from "@/components/RowMenu";

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

/**
 * Dense desktop table for Listings and Drafts (lg+ only; phones keep the
 * swipe cards). Mouse: checkbox / shift-click range select, row actions on
 * hover, "⋯" and right-click menus. Keyboard: see src/lib/row-keys.ts —
 * one row is in the Tab order at a time (roving tabindex), arrows move,
 * Space selects, Enter opens, Shift+F10 opens the menu.
 */
export default function DataTable<T>({
  rows,
  rowId,
  rowLabel,
  columns,
  selected,
  onSelectionChange,
  onOpen,
  menuActions,
  quickActions,
  caption,
}: {
  rows: T[];
  rowId: (r: T) => string;
  rowLabel: (r: T) => string;
  columns: Column<T>[];
  selected: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onOpen?: (r: T) => void;
  menuActions: (r: T) => RowAction[];
  quickActions?: (r: T) => RowAction[];
  caption: string;
}) {
  const [focusIdx, setFocusIdx] = useState(0);
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const anchor = useRef<string | null>(null);
  const body = useRef<HTMLTableSectionElement | null>(null);
  const ids = rows.map(rowId);
  const all = rows.length > 0 && ids.every((id) => selected.has(id));
  const some = !all && ids.some((id) => selected.has(id));

  const focusRow = (i: number) => {
    setFocusIdx(i);
    body.current?.querySelectorAll<HTMLElement>("tr[data-row]")[i]?.focus();
  };
  const toggle = (id: string, shift = false) => {
    const next = new Set(selected);
    if (shift && anchor.current) {
      const range = rangeIds(ids, anchor.current, id);
      const on = !selected.has(id);
      for (const r of range) { if (on) next.add(r); else next.delete(r); }
    } else if (next.has(id)) next.delete(id);
    else next.add(id);
    anchor.current = id;
    onSelectionChange(next);
  };
  const toggleAll = () => onSelectionChange(all ? new Set([...selected].filter((id) => !ids.includes(id))) : new Set([...selected, ...ids]));
  const menuRow = menu ? rows.find((r) => rowId(r) === menu.id) : undefined;

  return (
    <div className="card p-0 overflow-hidden" data-testid="data-table">
      <table className="w-full text-sm border-collapse">
        <caption className="sr-only">{caption}. Arrow keys move between rows, Space selects, Enter opens, Shift+F10 opens actions.</caption>
        <thead className="sticky top-0" style={{ zIndex: Z.sticky, background: "var(--bg-surface)" }}>
          <tr className="text-left text-xs" style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border)" }}>
            <th className="w-10 pl-4 py-2.5">
              <input
                type="checkbox"
                aria-label={all ? "Unselect all rows" : "Select all rows"}
                checked={all}
                ref={(el) => { if (el) el.indeterminate = some; }}
                onChange={toggleAll}
                className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
              />
            </th>
            {columns.map((c) => (
              <th key={c.id} scope="col" className={`py-2.5 pr-3 font-medium ${c.className ?? ""}`}>{c.header}</th>
            ))}
            <th className="w-[1%] pr-3"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody ref={body}>
          {rows.map((r, i) => {
            const id = rowId(r);
            const isSel = selected.has(id);
            const quick = quickActions?.(r) ?? [];
            return (
              <tr
                key={id}
                data-row=""
                tabIndex={i === Math.min(focusIdx, rows.length - 1) ? 0 : -1}
                aria-selected={isSel}
                aria-label={rowLabel(r)}
                className="hover-row group outline-none cursor-default focus-visible:shadow-[inset_3px_0_0_var(--accent)] hover:bg-[var(--glass)]"
                style={{ borderBottom: "1px solid var(--border)", background: isSel ? "var(--accent-tint)" : undefined }}
                onFocus={() => setFocusIdx(i)}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a,button,input,label")) return;
                  if (e.shiftKey || e.metaKey || e.ctrlKey) { toggle(id, e.shiftKey); return; }
                  onOpen?.(r);
                }}
                onDoubleClick={() => onOpen?.(r)}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ id, at: { x: e.clientX, y: e.clientY } }); }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return; // typing in an inline input
                  const a = rowKeyAction(e);
                  if (!a) return;
                  e.preventDefault();
                  if (a === "toggle") toggle(id, e.shiftKey);
                  else if (a === "open") onOpen?.(r);
                  else if (a === "selectAll") toggleAll();
                  else if (a === "menu") {
                    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setMenu({ id, at: { x: b.right - 220, y: b.bottom } });
                  } else focusRow(moveRowIndex(a, i, rows.length));
                }}
              >
                <td className="pl-4 py-2">
                  <input
                    type="checkbox"
                    tabIndex={-1}
                    aria-label={`Select ${rowLabel(r)}`}
                    checked={isSel}
                    onChange={() => {}}
                    onClick={(e) => { e.stopPropagation(); toggle(id, e.shiftKey); }}
                    className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
                  />
                </td>
                {columns.map((c) => (
                  <td key={c.id} className={`py-2 pr-3 align-middle ${c.className ?? ""}`}>{c.cell(r)}</td>
                ))}
                <td className="pr-3 py-2">
                  <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                    <div className="hover-actions flex items-center gap-1">
                      {quick.map((a) =>
                        a.href ? (
                          <a key={a.label} href={a.href} target={a.external ? "_blank" : undefined} rel={a.external ? "noopener noreferrer" : undefined}
                            className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium hover:bg-[var(--glass-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                            style={{ color: a.tone === "danger" ? "var(--danger)" : a.tone === "accent" ? "var(--accent)" : "var(--text-secondary)" }}>
                            {a.icon}{a.label}
                          </a>
                        ) : (
                          <button key={a.label} type="button" disabled={a.disabled} onClick={(e) => { e.stopPropagation(); a.onAction?.(); }}
                            className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium hover:bg-[var(--glass-strong)] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                            style={{ color: a.tone === "danger" ? "var(--danger)" : a.tone === "accent" ? "var(--accent)" : "var(--text-secondary)" }}>
                            {a.icon}{a.label}
                          </button>
                        ),
                      )}
                    </div>
                    <RowMenuButton label={`More actions for ${rowLabel(r)}`} onOpen={(at) => setMenu({ id, at })} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <RowMenu actions={menuRow ? menuActions(menuRow) : []} at={menuRow ? menu!.at : null} onClose={() => setMenu(null)} label={menuRow ? `Actions for ${rowLabel(menuRow)}` : undefined} />
    </div>
  );
}
