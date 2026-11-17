// Shared money formatting for the UI: always thousands separators.
const money2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** $3,063.79 (negative as -$12.50) */
export function formatMoney(n: number): string {
  return money2.format(Number.isFinite(n) ? n : 0);
}

/** $1,040 -- whole dollars for chart labels; $12.3k from $10,000 up so labels stay short. */
export function formatMoneyShort(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  if (Math.abs(v) >= 10_000) return `${v < 0 ? "-" : ""}$${(Math.abs(v) / 1000).toFixed(1)}k`;
  return money0.format(v);
}
