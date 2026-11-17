// One-tap counter-offer suggestions. Every preset sits strictly between
// the buyer's offer and the asking price (a counter at or below the offer
// would be pointless; at or above the ask is just "decline").
export interface CounterPreset {
  label: string;
  price: number; // dollars, exact cents
}

const c = (n: number) => Math.round(n * 100);

export function counterPresets(asking: number | null, offer: number | null): CounterPreset[] {
  if (asking == null || offer == null || !(asking > 0) || !(offer >= 0)) return [];
  const askC = c(asking), offC = c(offer);
  if (askC - offC < 2) return []; // nothing in between
  const raw: Array<[string, number]> = [
    ["−5%", Math.round(askC * 0.95)],
    ["−10%", Math.round(askC * 0.9)],
    ["Meet halfway", Math.round((askC + offC) / 2)],
  ];
  const seen = new Set<number>();
  return raw
    .filter(([, p]) => p > offC && p < askC && !seen.has(p) && seen.add(p))
    .sort((a, b) => b[1] - a[1])
    .map(([label, p]) => ({ label, price: p / 100 }));
}
