import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { events } from "@/db/schema";
import {
  clearHandlers,
  listStuckEvents,
  MAX_ATTEMPTS,
  on,
  processEvents,
  retryDelayMs,
  retryEvent,
  type EventRecord,
} from "@/lib/backstage/core/events";
import { closeDb, openEmbedded, type DbHandle } from "@/lib/db/client";
import { newId } from "@/lib/db/id";

let handle: DbHandle;

const T0 = new Date("2026-11-12T09:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

async function emit(type: string, at: Date = T0): Promise<string> {
  const id = newId("evt");
  await handle.db
    .insert(events)
    .values({ id, at, type, entityType: "order", entityId: "ord_x" });
  return id;
}

async function row(id: string) {
  const [found] = await handle.db
    .select()
    .from(events)
    .where(eq(events.id, id));
  if (found === undefined) throw new Error("no such event");
  return found;
}

beforeAll(async () => {
  handle = await openEmbedded();
});

afterAll(async () => {
  await handle.close();
  await closeDb();
});

beforeEach(async () => {
  clearHandlers();
  await handle.db.delete(events);
});

describe("processEvents", () => {
  it("hands an event to whoever listens for its kind, once", async () => {
    const seen: EventRecord[] = [];
    on("order.paid", "receipt", async (event) => {
      seen.push(event);
    });
    const id = await emit("order.paid");
    await emit("order.packed");

    const result = await processEvents(handle.db, { now: minutes(1) });
    expect(result).toEqual({ handled: 2, failed: 0, gaveUp: 0 });
    expect(seen.map((event) => event.id)).toEqual([id]);
    expect(seen[0]?.attempt).toBe(1);
    expect((await row(id)).processedAt).toEqual(minutes(1));

    // Nothing left to do the second time.
    const again = await processEvents(handle.db, { now: minutes(2) });
    expect(again.handled).toBe(0);
    expect(seen).toHaveLength(1);
  });

  it('lets "*" hear everything', async () => {
    const kinds: string[] = [];
    on("*", "automations", async (event) => {
      kinds.push(event.type);
    });
    await emit("order.paid", minutes(0));
    await emit("mail.received", minutes(1));
    await processEvents(handle.db, { now: minutes(2) });
    expect(kinds).toEqual(["order.paid", "mail.received"]);
  });

  it("marks an event nobody listens for as done", async () => {
    const id = await emit("nobody.cares");
    const result = await processEvents(handle.db, { now: minutes(1) });
    expect(result.handled).toBe(1);
    expect((await row(id)).processedAt).not.toBeNull();
  });

  it("replaces a listener registered twice under one name", async () => {
    let calls = 0;
    on("order.paid", "receipt", async () => {
      calls += 100;
    });
    on("order.paid", "receipt", async () => {
      calls += 1;
    });
    await emit("order.paid");
    await processEvents(handle.db, { now: minutes(1) });
    expect(calls).toBe(1);
  });

  it("tries a failed event again later, not straight away", async () => {
    let attempts = 0;
    on("order.paid", "receipt", async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("mail is down");
    });
    const id = await emit("order.paid");

    const first = await processEvents(handle.db, { now: minutes(0) });
    expect(first).toEqual({ handled: 0, failed: 1, gaveUp: 0 });
    const after = await row(id);
    expect(after.processedAt).toBeNull();
    expect(after.lastError).toBe("receipt: mail is down");
    expect(after.notBefore).toEqual(new Date(T0.getTime() + 30_000));

    // Ten seconds on it is not due yet.
    const tooSoon = await processEvents(handle.db, {
      now: new Date(T0.getTime() + 10_000),
    });
    expect(tooSoon).toEqual({ handled: 0, failed: 0, gaveUp: 0 });
    expect(attempts).toBe(1);

    await processEvents(handle.db, { now: minutes(1) });
    const third = await processEvents(handle.db, { now: minutes(10) });
    expect(third.handled).toBe(1);
    expect(attempts).toBe(3);
    const done = await row(id);
    expect(done.processedAt).toEqual(minutes(10));
    expect(done.lastError).toBeNull();
  });

  it("still runs the other listeners when one throws", async () => {
    const ran: string[] = [];
    on("order.paid", "a-broken", async () => {
      ran.push("a");
      throw new Error("no");
    });
    on("order.paid", "b-fine", async () => {
      ran.push("b");
    });
    await emit("order.paid");
    const result = await processEvents(handle.db, { now: minutes(0) });
    expect(ran).toEqual(["a", "b"]);
    expect(result.failed).toBe(1);
  });

  it("gives up after its tries and says so", async () => {
    on("order.paid", "receipt", async () => {
      throw new Error("still down");
    });
    const id = await emit("order.paid");

    let now = T0;
    let last = { handled: 0, failed: 0, gaveUp: 0 };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      last = await processEvents(handle.db, { now });
      now = new Date(now.getTime() + 2 * 60 * 60_000);
    }
    expect(last).toEqual({ handled: 0, failed: 0, gaveUp: 1 });
    expect((await row(id)).attempts).toBe(MAX_ATTEMPTS);

    // It is not picked up again by itself.
    const later = await processEvents(handle.db, { now });
    expect(later).toEqual({ handled: 0, failed: 0, gaveUp: 0 });

    const stuck = await listStuckEvents(handle.db);
    expect(stuck).toHaveLength(1);
    expect(stuck[0]?.gaveUp).toBe(true);
    expect(stuck[0]?.lastError).toBe("receipt: still down");

    // A person can send it round again.
    expect(await retryEvent(handle.db, id)).toBe(true);
    clearHandlers();
    on("order.paid", "receipt", async () => undefined);
    const retried = await processEvents(handle.db, { now });
    expect(retried.handled).toBe(1);
    expect(await retryEvent(handle.db, id)).toBe(false);
  });

  it("does not hand one event to two workers at once", async () => {
    let calls = 0;
    on("order.paid", "receipt", async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await emit("order.paid");
    const [a, b] = await Promise.all([
      processEvents(handle.db, { now: minutes(0) }),
      processEvents(handle.db, { now: minutes(0) }),
    ]);
    expect(calls).toBe(1);
    expect(a.handled + b.handled).toBe(1);
  });

  it("takes only the events it is pointed at", async () => {
    const seen: string[] = [];
    on("order.paid", "receipt", async (event) => {
      seen.push(event.id);
    });
    const mine = await emit("order.paid", minutes(1));
    const other = await emit("order.paid", minutes(0));
    await processEvents(handle.db, { ids: [mine], now: minutes(2) });
    expect(seen).toEqual([mine]);
    expect((await row(other)).processedAt).toBeNull();
    expect(
      await processEvents(handle.db, { ids: [], now: minutes(2) }),
    ).toEqual({ handled: 0, failed: 0, gaveUp: 0 });
  });

  it("works oldest first and respects the limit", async () => {
    const seen: string[] = [];
    on("tick", "t", async (event) => {
      seen.push(event.id);
    });
    const second = await emit("tick", minutes(2));
    const first = await emit("tick", minutes(1));
    const third = await emit("tick", minutes(3));
    await processEvents(handle.db, { limit: 2, now: minutes(5) });
    expect(seen).toEqual([first, second]);
    await processEvents(handle.db, { now: minutes(5) });
    expect(seen).toEqual([first, second, third]);
  });
});

describe("retryDelayMs", () => {
  it("doubles from thirty seconds and stops at an hour", () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(4)).toBe(240_000);
    expect(retryDelayMs(8)).toBe(3_600_000);
    expect(retryDelayMs(50)).toBe(3_600_000);
  });
});
