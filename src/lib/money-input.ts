// Shared rules for money/percent text inputs (CurrencyInput).

/**
 * Keep only what a price can contain: digits, one decimal point, an
 * optional leading minus, and (for money) at most 2 decimals. "12.345" →
 * "12.34", "$1,299.5" → "1299.5", "--3" → "-3".
 */
export function sanitizeMoneyInput(raw: string, opts: { allowNegative?: boolean; maxDecimals?: number } = {}): string {
  const { allowNegative = false, maxDecimals = 2 } = opts;
  let s = raw.replace(/[^0-9.\-]/g, "");
  const negative = allowNegative && s.trimStart().startsWith("-");
  s = s.replace(/-/g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) {
    const whole = s.slice(0, dot);
    const frac = s.slice(dot + 1).replace(/\./g, "").slice(0, maxDecimals);
    s = `${whole}.${frac}`;
  }
  return (negative ? "-" : "") + s;
}
