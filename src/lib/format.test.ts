import { describe, it, expect } from "vitest";
import { formatMoney, formatMoneyShort } from "./format";

describe("money formatting", () => {
  it("adds thousands separators and two decimals", () => {
    expect(formatMoney(3063.79)).toBe("$3,063.79");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(-12.5)).toBe("-$12.50");
    expect(formatMoney(Number.NaN)).toBe("$0.00");
  });
  it("chart labels: whole dollars with separators, k only from $10,000", () => {
    expect(formatMoneyShort(1040.4)).toBe("$1,040");
    expect(formatMoneyShort(415.5)).toBe("$416");
    expect(formatMoneyShort(9999)).toBe("$9,999");
    expect(formatMoneyShort(12345)).toBe("$12.3k");
  });
});
