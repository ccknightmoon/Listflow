// Keyboard model for the desktop tables (Listings, Drafts). Pure so it can
// be unit-tested without a DOM.
//
//   ↑/↓ or j/k   move between rows        Home/End   first / last row
//   Space / x    select / unselect row    Enter      open the row
//   Shift+F10, the Menu key, or "."       open the row's actions menu
//   Ctrl/⌘+A     select every row
export type RowKeyAction = "next" | "prev" | "first" | "last" | "toggle" | "open" | "menu" | "selectAll" | null;

export function rowKeyAction(e: { key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): RowKeyAction {
  if (e.altKey) return null;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") return "selectAll";
  if (e.metaKey || e.ctrlKey) return null;
  switch (e.key) {
    case "ArrowDown": case "j": return "next";
    case "ArrowUp": case "k": return "prev";
    case "Home": return "first";
    case "End": return "last";
    case " ": case "x": return "toggle";
    case "Enter": return "open";
    case "ContextMenu": case ".": return "menu";
    case "F10": return e.shiftKey ? "menu" : null;
    default: return null;
  }
}

/** Target row index after a move action, clamped to the list. */
export function moveRowIndex(action: RowKeyAction, current: number, count: number): number {
  if (count <= 0) return -1;
  const i = Math.max(0, Math.min(current, count - 1));
  switch (action) {
    case "next": return Math.min(count - 1, i + 1);
    case "prev": return Math.max(0, i - 1);
    case "first": return 0;
    case "last": return count - 1;
    default: return i;
  }
}

/** Shift-click range select: ids from the anchor row to the clicked row, inclusive. */
export function rangeIds(ids: string[], anchorId: string | null, clickedId: string): string[] {
  const b = ids.indexOf(clickedId);
  const a = anchorId ? ids.indexOf(anchorId) : -1;
  if (b === -1) return [];
  if (a === -1) return [clickedId];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return ids.slice(lo, hi + 1);
}

/** Keep a context menu fully on screen. */
export function clampMenuPosition(x: number, y: number, menuW: number, menuH: number, viewW: number, viewH: number, margin = 8) {
  return {
    x: Math.max(margin, Math.min(x, viewW - menuW - margin)),
    y: Math.max(margin, Math.min(y, viewH - menuH - margin)),
  };
}
