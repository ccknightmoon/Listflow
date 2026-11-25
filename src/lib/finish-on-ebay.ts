// "Finish on eBay" = the main hand-off from Listflow to the eBay app.
//
// Why a scheduled listing and not an eBay draft: eBay's APIs give outside
// apps no way to create (or read) drafts in the eBay app's Drafts tab --
// that tab only holds drafts started on eBay itself. The closest thing an
// app can create is a real listing scheduled to start later: it appears in
// the eBay app under Selling → Scheduled, where the seller can edit it and
// tap "List it now". Listflow schedules it 3 weeks out so nothing goes
// live by accident.
export const FINISH_SCHEDULE_DAYS = 21;
const SEEN_KEY = "listflow:finish-on-ebay-explained:v1";

export const FINISH_STEPS = [
  "Listflow puts it on eBay as a scheduled listing (goes live in 3 weeks, not now).",
  "Open the eBay app → Selling → Scheduled. It's there within a minute.",
  "Edit anything you like, then tap \"List it now\" — or let it start on its own.",
  "Listflow keeps it in Inventory → Scheduled and picks up your eBay-app edits automatically.",
] as const;

export const DRAFTS_TAB_NOTE =
  "Why not the eBay app's Drafts tab? eBay doesn't let outside apps (Listflow included) add to or read that tab — it only holds drafts started on eBay itself. Scheduled is the closest place eBay allows.";

export const FEE_NOTE =
  "eBay lists scheduling as free on its US fees page. The usual insertion-fee rules apply as for any listing (free within your monthly free listings).";

export function hasSeenFinishExplainer(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markFinishExplainerSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // storage blocked: they'll just see it again next time
  }
}
