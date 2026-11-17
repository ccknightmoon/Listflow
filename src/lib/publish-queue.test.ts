import { describe, it, expect } from "vitest";
import { createPublishQueue, summarizeQueue, type ListResponse } from "./publish-queue";

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 20; i++) await tick(); };

describe("background publish queue", () => {
  it("publishes everything, never more than 2 at once", async () => {
    let inFlight = 0, maxInFlight = 0;
    const q = createPublishQueue(async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await tick(); await tick();
      inFlight--;
      return { success: true, url: "https://ebay.com/itm/1" };
    });
    for (let i = 0; i < 6; i++) q.enqueue({ draftId: `d${i}`, title: `Item ${i}` });
    await settle();
    expect(maxInFlight).toBe(2);
    expect(summarizeQueue(q.getItems())).toMatchObject({ total: 6, listed: 6, failed: 0, active: 0 });
  });

  it("marks failures with eBay's message and retries on request", async () => {
    let calls = 0;
    const q = createPublishQueue(async (): Promise<ListResponse> => {
      calls++;
      return calls === 1 ? { error: "Invalid <ShippingPackage>." } : { success: true };
    });
    q.enqueue({ draftId: "a", title: "A" });
    await settle();
    expect(q.getItems()[0]).toMatchObject({ status: "failed", error: "Invalid <ShippingPackage>." });
    q.retry("a");
    await settle();
    expect(q.getItems()[0].status).toBe("listed");
  });

  it("flags reconnect, survives thrown errors, and never double-queues a draft", async () => {
    const q = createPublishQueue(async (id) => {
      if (id === "boom") throw new Error("offline");
      return { reconnect: true, error: "eBay token expired." };
    });
    q.enqueue({ draftId: "r", title: "R" });
    q.enqueue({ draftId: "r", title: "R again" }); // ignored while queued
    q.enqueue({ draftId: "boom", title: "B" });
    await settle();
    expect(q.getItems()).toHaveLength(2);
    expect(q.getItems().find((i) => i.draftId === "r")).toMatchObject({ status: "failed", needsReconnect: true });
    expect(q.getItems().find((i) => i.draftId === "boom")).toMatchObject({ status: "failed", error: "offline" });
  });

  it("clearFinished keeps only work in progress", async () => {
    const q = createPublishQueue(async () => ({ success: true }));
    q.enqueue({ draftId: "x", title: "X" });
    await settle();
    q.clearFinished();
    expect(q.getItems()).toHaveLength(0);
  });
});

describe("generic background tasks (price changes) share the queue", () => {
  it("runs custom tasks with their own function and keeps the note", async () => {
    const q = createPublishQueue(async () => ({ error: "should not be called" }));
    let ran = 0;
    q.enqueueTask({ id: "price:1", title: "Tee", kind: "price", note: "$27.99 → $23.79", run: async () => { ran++; return { success: true }; } });
    await settle();
    expect(ran).toBe(1);
    expect(q.getItems()[0]).toMatchObject({ status: "listed", kind: "price", note: "$27.99 → $23.79" });
    expect(summarizeQueue(q.getItems(), "price").listed).toBe(1);
    expect(summarizeQueue(q.getItems(), "publish").total).toBe(0);
  });
});
