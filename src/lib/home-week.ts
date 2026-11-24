// Browser-safe (no server imports): used by the Dashboard and by
// src/lib/dashboard-summary.ts on the server.
import { currentPeriod, saleDate, type AnalyticsSale } from "@/lib/sales-analytics";
import type { BucketableSale } from "@/lib/sales-buckets";

/** A paid sale line for Home: same parsing/filters as the Sales page. */
export interface HomeSale extends BucketableSale {
  qty: number;
}

/**
 * "Last 7 days" exactly as the Sales page's 7-day tab defines it: today
 * plus the 6 days before it, from local midnight (sales-analytics.ts
 * currentPeriod). Item sales (no shipping/tax) and items sold (units).
 */
export function lastSevenDays(sales: HomeSale[], nowMs: number): { revenue: number; sales: number } {
  const p = currentPeriod(7, nowMs);
  let cents = 0;
  let units = 0;
  for (const s of sales) {
    const t = Date.parse(s.soldAt);
    if (t >= p.start && t < p.end) { cents += Math.round(s.total * 100); units += s.qty; }
  }
  return { revenue: cents / 100, sales: units };
}


/**
 * The Sales feed's lines for the last ~9 days as HomeSales, dated exactly
 * as the Sales page dates them (eBay's transaction date, else the order
 * date -- sales-analytics saleDate). Fed to lastSevenDays() on Home so the
 * two screens show the same "Last 7 days" whenever the feed is available.
 */
export function homeSalesFromFeed(sales: Array<Pick<AnalyticsSale, "soldAt" | "bookedAt" | "itemTotal" | "qty">>, nowMs: number): HomeSale[] {
  const from = nowMs - 9 * 86_400_000;
  const out: HomeSale[] = [];
  for (const s of sales) {
    const d = saleDate(s);
    const t = Date.parse(d);
    if (!Number.isFinite(t) || t < from) continue;
    out.push({ soldAt: d, total: s.itemTotal, qty: s.qty });
  }
  return out;
}
