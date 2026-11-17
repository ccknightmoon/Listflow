// Smoke test: the Sales page renders every section from a realistic feed
// without throwing, and the numbers on screen are the exact eBay ones.
import { describe, it, expect, vi } from "vitest";

// The page now renders the app's bottom nav, which needs Next's router.
vi.mock("next/navigation", () => ({ usePathname: () => "/sales", useRouter: () => ({ push: () => {} }) }));
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { setPageCache } from "@/lib/page-cache";
import SalesPage from "./page";

const DAY = 86_400_000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

function feed() {
  const sales = Array.from({ length: 40 }, (_, i) => ({
    key: `k${i}`, listingId: String(100000000000 + i), title: ["Nike Tee L", "Levi's 501 Jeans", "Carhartt Hoodie"][i % 3],
    qty: 1, itemTotal: 20 + i, shippingPaid: i % 4 === 0 ? 0 : 6.5, taxPaid: 1.5,
    soldAt: iso(now - i * 0.6 * DAY), bookedAt: iso(now - i * 0.6 * DAY + 60_000), orderId: `O-${i}`,
    listedAt: iso(now - i * 0.6 * DAY - 12 * DAY), ebayCategory: null, storeCategoryName: null, itemType: null,
    costBasis: i % 5 === 0 ? 4 : null, actualFee: 3.25, thumbnail: null, hasDraft: false,
  }));
  const ledger = sales.flatMap((s, i) => [
    { id: `S${i}`, type: "SALE", status: "PAYOUT", date: s.bookedAt, orderId: s.orderId, payoutId: "P1", feeType: null, memo: null,
      amountCents: Math.round((s.itemTotal + s.shippingPaid) * 100) - 325, feeCents: 325 },
    { id: `L${i}`, type: "SHIPPING_LABEL", status: "PAYOUT", date: s.bookedAt, orderId: s.orderId, payoutId: "P1", feeType: null, memo: "USPS label", amountCents: -599, feeCents: 0 },
  ]).concat([
    { id: "D1", type: "DISPUTE", status: "PAYOUT", date: iso(now - 3 * DAY), orderId: "O-3", payoutId: "P1", feeType: null, memo: null, amountCents: -10770, feeCents: 0 },
    { id: "C1", type: "CREDIT", status: "PAYOUT", date: iso(now - 2 * DAY), orderId: "O-3", payoutId: "P1", feeType: null, memo: null, amountCents: 10770, feeCents: 0 },
  ]);
  return {
    generatedAt: iso(now), feedStart: iso(now - 90 * DAY), sales,
    excluded: { cancelled: 1, awaitingPayment: 0 }, truncated: false,
    finances: { available: true, truncated: false, refunds: [], labels: [], otherCharges: [] },
    ledger, payouts: [{ id: "P1", date: iso(now - DAY), amountCents: 50000, status: "SUCCEEDED" }],
    active: Array.from({ length: 30 }, (_, i) => ({ listingId: String(i), title: `Listing ${i}`, startTime: iso(now - i * 5 * DAY), price: 25 })),
    activeCount: 30, feePercent: 13.6, saleCostsAvailable: false,
  };
}

describe("Sales page render", () => {
  it("renders every section with eBay-exact money and separators", () => {
    setPageCache("sales-analytics-feed", feed());
    const html = renderToString(createElement(SalesPage));
    for (const text of ["Profit before item costs", "Where the money goes", "eBay shipping labels", "Shipping", "How to improve", "Profit by category", "Best &amp; worst sales", "Active listings by age", "Sell-through"]) {
      expect(html, text).toContain(text);
    }
    expect(html).not.toContain("Uncategorized");
    expect(html).toContain("Shipping charged to buyers");
    expect(html).toContain("resolved");
    expect(html).toContain("net $0");
    const tie = html.slice(html.indexOf("settled on eBay Finances"), html.indexOf("settled on eBay Finances") + 40);
    expect(tie).toContain("✓");
    expect(html).not.toContain("NaN");
    expect(html).toMatch(/\$\d{1,3}(,\d{3})*\.\d{2}/);
  });
});
