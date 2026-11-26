import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { checkoutLineItems, effectivePlan, entitlementsFor, monthlyTotalUsd, PLANS, upgradeMessage } from "@/lib/billing/plans";
import { formEncode, isTestKey, missingStripeConfig, stripeEnv, subscriptionToRow, verifyStripeSignature, StripeConfigError } from "@/lib/billing/stripe";
import { handleStripeEvent } from "@/lib/billing/webhook";

const fromMock = vi.fn();
vi.mock("@/lib/supabase-service", () => ({ getServiceClient: () => ({ from: fromMock }) }));

const USER = "11111111-2222-3333-4444-555555555555";
const PRICES = { pro: "price_pro", power: "price_power", seat: "price_seat" };

describe("plans", () => {
  it("has the agreed prices", () => {
    expect(PLANS.free.priceUsd).toBe(0);
    expect(PLANS.pro.priceUsd).toBe(29);
    expect(PLANS.power.priceUsd).toBe(59);
    expect(PLANS.free.features).toEqual([]);
    for (const f of ["ai", "bulk", "sync", "helpers"] as const) {
      expect(PLANS.pro.features).toContain(f);
      expect(PLANS.power.features).toContain(f);
    }
  });

  it("billing off = everything allowed (today's behaviour)", () => {
    const e = entitlementsFor({ billingEnabled: false, exempt: false, sub: null });
    expect(e.unlimited).toBe(true);
    expect(Object.values(e.can).every(Boolean)).toBe(true);
  });

  it("billing on: Free can list by hand only; Pro gets AI/bulk/sync; exempt owner gets all", () => {
    const free = entitlementsFor({ billingEnabled: true, exempt: false, sub: null });
    expect(free.plan).toBe("free");
    expect(free.can).toEqual({ ai: false, bulk: false, sync: false, helpers: false });
    const pro = entitlementsFor({ billingEnabled: true, exempt: false, sub: { plan: "pro", status: "active", seats: 2 } });
    expect(pro.can.ai && pro.can.bulk && pro.can.sync).toBe(true);
    expect(pro.seats).toBe(2);
    expect(entitlementsFor({ billingEnabled: true, exempt: true, sub: null }).unlimited).toBe(true);
  });

  it("only active-ish Stripe statuses keep a paid plan", () => {
    expect(effectivePlan({ plan: "pro", status: "trialing", seats: 0 })).toBe("pro");
    expect(effectivePlan({ plan: "pro", status: "past_due", seats: 0 })).toBe("pro");
    expect(effectivePlan({ plan: "pro", status: "canceled", seats: 0 })).toBe("free");
    expect(effectivePlan({ plan: "pro", status: "incomplete", seats: 0 })).toBe("free");
  });

  it("builds checkout line items and totals", () => {
    expect(checkoutLineItems("pro", 0, PRICES)).toEqual([{ price: "price_pro", quantity: 1 }]);
    expect(checkoutLineItems("power", 3, PRICES)).toEqual([{ price: "price_power", quantity: 1 }, { price: "price_seat", quantity: 3 }]);
    expect(checkoutLineItems("free", 0, PRICES)).toBeNull();
    expect(checkoutLineItems("pro", 2, { pro: "p" })).toBeNull();
    expect(checkoutLineItems("pro", 999, PRICES)?.[1].quantity).toBe(20);
    expect(monthlyTotalUsd("pro", 2)).toBe(49);
    expect(upgradeMessage("ai")).toMatch(/Pro \(\$29\/mo\)/);
  });
});

describe("stripe (test mode only)", () => {
  it("accepts only test keys", () => {
    expect(isTestKey("sk_test_abc123")).toBe(true);
    expect(isTestKey("rk_test_abc123")).toBe(true);
    expect(isTestKey("sk_live_abc123")).toBe(false);
    expect(isTestKey(undefined)).toBe(false);
    expect(() => stripeEnv({ STRIPE_SECRET_KEY: "sk_live_x" })).toThrow(StripeConfigError);
    expect(missingStripeConfig({ STRIPE_SECRET_KEY: "sk_live_x" }).join(" ")).toMatch(/TEST key/);
    expect(missingStripeConfig({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "w", STRIPE_PRICE_PRO: "a", STRIPE_PRICE_POWER: "b", STRIPE_PRICE_SEAT: "c" })).toEqual([]);
  });

  it("form-encodes nested Stripe params", () => {
    expect(decodeURIComponent(formEncode({ mode: "subscription", line_items: [{ price: "p", quantity: 1 }], metadata: { user_id: "u" } }))).toBe("mode=subscription&line_items[0][price]=p&line_items[0][quantity]=1&metadata[user_id]=u");
  });

  it("verifies webhook signatures and rejects stale or wrong ones", () => {
    const now = 1_800_000_000;
    const body = '{"id":"evt_1"}';
    const sig = createHmac("sha256", "whsec_x").update(`${now}.${body}`).digest("hex");
    expect(verifyStripeSignature(body, `t=${now},v1=${sig}`, "whsec_x", now)).toBe(true);
    expect(verifyStripeSignature(body, `t=${now},v1=${sig}`, "whsec_other", now)).toBe(false);
    expect(verifyStripeSignature(body, `t=${now - 1000},v1=${sig}`, "whsec_x", now)).toBe(false);
    expect(verifyStripeSignature(body + " ", `t=${now},v1=${sig}`, "whsec_x", now)).toBe(false);
    expect(verifyStripeSignature(body, null, "whsec_x", now)).toBe(false);
  });

  it("maps a subscription to plan + seats", () => {
    const row = subscriptionToRow({ id: "sub_1", customer: "cus_1", status: "active", current_period_end: 1_800_000_000, items: { data: [{ price: { id: "price_power" }, quantity: 1 }, { price: { id: "price_seat" }, quantity: 4 }] } }, PRICES);
    expect(row).toEqual({ plan: "power", seats: 4, status: "active", currentPeriodEnd: new Date(1_800_000_000_000).toISOString() });
  });
});

describe("webhook handler", () => {
  const save = vi.fn(async () => {});
  beforeEach(() => save.mockClear());

  it("ignores live-mode events", async () => {
    const r = await handleStripeEvent({ id: "e", type: "customer.subscription.updated", livemode: true, data: { object: {} } }, PRICES, save);
    expect(r.handled).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("links the Stripe customer on checkout", async () => {
    const r = await handleStripeEvent({ id: "e", type: "checkout.session.completed", data: { object: { client_reference_id: USER, customer: "cus_1", subscription: "sub_1" } } }, PRICES, save);
    expect(r).toMatchObject({ handled: true, userId: USER });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ user_id: USER, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" }));
  });

  it("saves plan/seats on subscription updates and drops to Free on delete", async () => {
    const sub = { id: "sub_1", customer: "cus_1", status: "active", metadata: { user_id: USER }, items: { data: [{ price: { id: "price_pro" }, quantity: 1 }, { price: { id: "price_seat" }, quantity: 2 }] } };
    await handleStripeEvent({ id: "e", type: "customer.subscription.updated", data: { object: sub } }, PRICES, save);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ plan: "pro", seats: 2, status: "active" }));
    await handleStripeEvent({ id: "e", type: "customer.subscription.deleted", data: { object: { ...sub, status: "canceled" } } }, PRICES, save);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ plan: "free", seats: 0, status: "canceled" }));
  });

  it("refuses events without a Listflow user id", async () => {
    const r = await handleStripeEvent({ id: "e", type: "customer.subscription.updated", data: { object: { id: "s", customer: "c", status: "active" } } }, PRICES, save);
    expect(r.handled).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("entitlements gate", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; fromMock.mockReset(); vi.resetModules(); });

  it("with billing off it never reads the database and never blocks", async () => {
    delete process.env.BILLING_ENABLED;
    const { featureBlocked, planGate } = await import("@/lib/billing/entitlements");
    expect(await featureBlocked(USER, "ai")).toBeNull();
    expect(await planGate(USER, "ai", "bulk")).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("with billing on: Free is blocked from AI (402), exempt owner is not, errors fail open", async () => {
    process.env.BILLING_ENABLED = "1";
    process.env.BILLING_EXEMPT_USER_IDS = "owner-id";
    fromMock.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) });
    const { featureBlocked, planGate } = await import("@/lib/billing/entitlements");
    expect(await featureBlocked(USER, "ai")).toMatch(/Pro/);
    expect((await planGate(USER, "bulk"))?.status).toBe(402);
    expect(await featureBlocked("owner-id", "ai")).toBeNull();
    fromMock.mockImplementation(() => { throw new Error("db down"); });
    expect(await featureBlocked("22222222-2222-3333-4444-555555555555", "ai")).toBeNull();
  });
});
