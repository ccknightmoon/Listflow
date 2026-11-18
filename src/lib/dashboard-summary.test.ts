import { describe, it, expect, vi } from "vitest";
import {
  countStaleSorted,
  parseSortedPage,
  parseTrendSales,
  lastSevenDays,
  getDashboardSummary,
  invalidateDashboardSummary,
  SUMMARY_TTL_MS,
  type DashboardSummary,
  type SortedPage,
} from "@/lib/dashboard-summary";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-17T12:00:00Z");
const CUTOFF = NOW - 30 * DAY;

// N listings, oldest first; the first `stale` of them started 31+ days ago.
function makeStore(n: number, stale: number, pageSize: number) {
  const times = Array.from({ length: n }, (_, i) =>
    new Date(i < stale ? CUTOFF - (stale - i) * DAY : CUTOFF + (i - stale + 1) * 60_000).toISOString(),
  );
  const calls: number[] = [];
  const fetchPage = async (p: number): Promise<SortedPage> => {
    calls.push(p);
    return { total: n, startTimes: times.slice((p - 1) * pageSize, p * pageSize) };
  };
  return { fetchPage, calls };
}

describe("countStaleSorted", () => {
  it.each([
    [1300, 1000],
    [1300, 0],
    [1300, 1300],
    [1300, 25],
    [1300, 26],
    [7, 3],
    [0, 0],
  ])("%i listings, %i stale", async (n, stale) => {
    const { fetchPage, calls } = makeStore(n, stale, 25);
    expect(await countStaleSorted(fetchPage, CUTOFF, 25)).toBe(stale);
    expect(calls.length).toBeLessThanOrEqual(8); // vs 7 full 200-item pages before
  });

  it("gives up (null) if eBay didn't sort oldest-first", async () => {
    const fetchPage = async () => ({ total: 3, startTimes: ["2026-11-10T00:00:00Z", "2026-01-01T00:00:00Z", "2026-11-11T00:00:00Z"] });
    expect(await countStaleSorted(fetchPage, CUTOFF, 25)).toBeNull();
  });

  it("gives up (null) if a page fails", async () => {
    const { fetchPage } = makeStore(1300, 600, 25);
    const flaky = async (p: number) => (p === 1 ? fetchPage(p) : null);
    expect(await countStaleSorted(flaky, CUTOFF, 25)).toBeNull();
  });
});

describe("parseSortedPage", () => {
  it("reads total and start times from the ActiveList block", () => {
    const body = `<GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList><ItemArray><Item><ItemID>1</ItemID><ListingDetails><StartTime>2026-09-01T00:00:00.000Z</StartTime></ListingDetails></Item><Item><ItemID>2</ItemID><ListingDetails><StartTime>2026-10-01T00:00:00.000Z</StartTime></ListingDetails></Item></ItemArray><PaginationResult><TotalNumberOfPages>52</TotalNumberOfPages><TotalNumberOfEntries>1300</TotalNumberOfEntries></PaginationResult></ActiveList></GetMyeBaySellingResponse>`;
    expect(parseSortedPage(body)).toEqual({ total: 1300, startTimes: ["2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"] });
  });
  it("returns null on failure", () => {
    expect(parseSortedPage("<Ack>Failure</Ack>")).toBeNull();
  });
});

let txId = 0;
const tx = (price: string, qty: string, created: string, extra = "<PaidTime>2026-11-01T00:00:00Z</PaidTime>") =>
  `<Transaction><TransactionID>${++txId}</TransactionID><Item><ItemID>1${txId}</ItemID><Title>T</Title></Item><TransactionPrice currencyID="USD">${price}</TransactionPrice><QuantityPurchased>${qty}</QuantityPurchased><CreatedDate>${created}</CreatedDate>${extra}</Transaction>`;

describe("Home sales use the Sales page's definitions", () => {
  const body = `<Ack>Success</Ack><TransactionArray>${[
    tx("10.00", "1", new Date(NOW - 2 * DAY).toISOString()),
    tx("5.00", "2", new Date(NOW - 10 * DAY).toISOString()),
    tx("99.00", "1", new Date(NOW - 40 * DAY).toISOString()), // touched recently, sold long ago
    tx("0", "1", new Date(NOW - 1 * DAY).toISOString()),
    tx("31.00", "1", new Date(NOW - 1 * DAY).toISOString(), "<ContainingOrder><CancelStatus>CancelComplete</CancelStatus></ContainingOrder><PaidTime>2026-11-01T00:00:00Z</PaidTime>"), // cancelled
    tx("8.00", "1", new Date(NOW - 1 * DAY).toISOString(), "<Status><CheckoutStatus>CheckoutIncomplete</CheckoutStatus></Status>"), // unpaid
  ].join("")}</TransactionArray>`;

  it("keeps paid sales by real sale date inside the 28-day window; drops cancelled and unpaid", () => {
    expect(parseTrendSales(body, NOW - 28 * DAY).map((s) => [s.total, s.qty])).toEqual([[10, 1], [10, 2]]);
  });
  it("last 7 days = today + 6 days back from local midnight, item sales and units", () => {
    const sales = parseTrendSales(body, NOW - 28 * DAY);
    expect(lastSevenDays(sales, NOW)).toEqual({ revenue: 10, sales: 1 });
    // the window starts at local midnight 6 days back, so 5.9 days ago is always in and 7.5 never (any time zone)
    const edge = [{ soldAt: new Date(NOW - 5.9 * DAY).toISOString(), total: 4, qty: 1 }, { soldAt: new Date(NOW - 7.5 * DAY).toISOString(), total: 50, qty: 1 }];
    expect(lastSevenDays(edge, NOW)).toEqual({ revenue: 4, sales: 1 });
  });
});

describe("getDashboardSummary cache", () => {
  const summary = (n: number): DashboardSummary => ({
    active: n, weeklyRevenue: 0, weeklySales: 0, trendSales: [], shipCount: 0,
    pendingOffers: 0, buyerQuestions: 0, staleListings: 0, generatedAt: "x",
  });

  it("builds once per TTL per seller, shares in-flight builds, and refreshes on demand", async () => {
    let t = 1_000;
    const now = () => t;
    let n = 0;
    const build = vi.fn(async () => summary(++n));

    const [a, b] = await Promise.all([getDashboardSummary("u1", false, build, now), getDashboardSummary("u1", false, build, now)]);
    expect(a.active).toBe(1);
    expect(b.active).toBe(1);
    expect(build).toHaveBeenCalledTimes(1);

    t += SUMMARY_TTL_MS - 1;
    expect((await getDashboardSummary("u1", false, build, now)).active).toBe(1);

    expect((await getDashboardSummary("u1", true, build, now)).active).toBe(2);
    t += SUMMARY_TTL_MS + 1;
    expect((await getDashboardSummary("u1", false, build, now)).active).toBe(3);

    expect((await getDashboardSummary("u2", false, build, now)).active).toBe(4);
    invalidateDashboardSummary("u1");
    expect((await getDashboardSummary("u1", false, build, now)).active).toBe(5);
  });
});
