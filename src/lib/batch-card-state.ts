// When a Batch Upload review card's fields are editable (pure, tested in
// batch-card-state.test.ts).
//
// Nov 25, 2026 bug: every field was disabled while saveStatus === "saved".
// "List on eBay" first saves the draft (which sets "saved"), so when eBay
// then rejected the listing (Size "9") the card stayed locked with no way
// to fix the field and retry. Now a card is only locked while a save/list
// is actually in flight, or once the item is live on eBay. An explicit
// "Saved" is a confirmation, not a lock.
export type SaveStatus = "idle" | "saving" | "saved" | "auto" | "error";
export type ListStatus = "idle" | "saving" | "listing" | "listed" | "error";

export function isCardLocked(save: SaveStatus | undefined, list: ListStatus | undefined): boolean {
  return save === "saving" || list === "saving" || list === "listing" || list === "listed";
}

/**
 * After the seller edits a field on a card that was "saved", the edit
 * isn't in the draft yet: drop back to "auto" (backed up) so Save draft is
 * offered again and the next List re-saves first (it always does).
 */
export function statusAfterEdit(save: SaveStatus | undefined): SaveStatus | undefined {
  return save === "saved" ? "auto" : save;
}

/**
 * After a failed List/Check: the draft row exists, but the seller must be
 * able to fix and retry — never leave it as a locking "saved".
 */
export function statusAfterListFailure(save: SaveStatus | undefined): SaveStatus | undefined {
  return save === "saved" || save === "saving" ? "auto" : save;
}

/**
 * Same set of photo groups as the batch that was analyzed before? Per-item
 * state (draft ids, prices, store categories…) is keyed by position, so it
 * may only be kept when the items themselves are unchanged.
 */
export function sameGroups(a: number[][] | null | undefined, b: number[][]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((g, i) => g.length === b[i].length && g.every((x, j) => x === b[i][j]));
}
