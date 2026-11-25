// The dashboard's "Needs attention" inbox: one list, most urgent first,
// only things that actually need Sel right now.
export interface AttentionCounts {
  toShip: number | null;
  offers: number | null;
  questions: number | null;
  failedListings: number | null;
  draftsNeedPhoto: number | null;
  draftsNeedPrice: number | null;
  stale: number | null;
}

export interface AttentionItem {
  key: keyof AttentionCounts;
  label: string;
  detail: string;
  count: number;
  href: string;
  tone: "danger" | "accent" | "warning";
}

const DEFS: Array<Omit<AttentionItem, "count"> & { one: string }> = [
  { key: "toShip", label: "Orders to ship", one: "Order to ship", detail: "Buyers are waiting — pack and ship", href: "/ship", tone: "danger" },
  { key: "offers", label: "Offers waiting", one: "Offer waiting", detail: "Accept, counter or decline", href: "/offers", tone: "accent" },
  { key: "questions", label: "Buyer questions", one: "Buyer question", detail: "Quick replies help close sales", href: "/messages", tone: "accent" },
  { key: "failedListings", label: "Listings that failed", one: "Listing that failed", detail: "Open the tray below to retry", href: "#publish-tray", tone: "danger" },
  { key: "draftsNeedPhoto", label: "Drafts missing photos", one: "Draft missing photos", detail: "Add a photo to list them", href: "/inventory?status=draft&filter=needs-photo", tone: "warning" },
  { key: "draftsNeedPrice", label: "Drafts missing a price", one: "Draft missing a price", detail: "Set a price to list them", href: "/inventory?status=draft&filter=needs-price", tone: "warning" },
  { key: "stale", label: "Stale listings", one: "Stale listing", detail: "30+ days live — lower prices or send offers", href: "/inventory?status=live&filter=stale", tone: "warning" },
];

export function attentionItems(c: AttentionCounts): AttentionItem[] {
  return DEFS.filter((d) => (c[d.key] ?? 0) > 0).map(({ one, ...d }) => {
    const count = c[d.key] as number;
    return { ...d, label: count === 1 ? one : d.label, count };
  });
}

/** null while anything is still loading for the first time. */
export function allCaughtUp(c: AttentionCounts): boolean | null {
  const vals = Object.values(c);
  if (vals.some((v) => v === null)) return null;
  return vals.every((v) => v === 0);
}
