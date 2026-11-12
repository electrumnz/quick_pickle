import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { auditLog, customers, events, users } from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { OpError } from "@/lib/backstage/core/errors";
import {
  defineOp,
  describeOp,
  execute,
  onEventsCommitted,
} from "@/lib/backstage/core/op";
import { openEmbedded, type DbHandle } from "@/lib/db/client";
import { newId } from "@/lib/db/id";

const addCustomer = defineOp({
  name: "test.addCustomer",
  title: "Add a customer",
  description: "Test only.",
  access: "write",
  input: z.object({
    email: z.string().email("That email doesn't look right"),
    fail: z.boolean().default(false),
    quiet: z.boolean().default(false),
  }),
  async run(ctx, input) {
    const id = newId("cus");
    await ctx.db.insert(customers).values({ id, email: input.email });
    if (!input.quiet) {
      await ctx.audit({
        entity: { type: "customer", id },
        summary: `Added ${input.email}`,
      });
    }
    await ctx.emit({
      type: "customer.added",
      entity: { type: "customer", id },
    });
    if (input.fail) throw new Error("it broke");
    return { id };
  },
});

const countCustomers = defineOp({
  name: "test.countCustomers",
  title: "Count customers",
  description: "Test only.",
  access: "read",
  input: z.object({}),
  async run(ctx) {
    return (await ctx.db.select().from(customers)).length;
  },
});

const wipe = defineOp({
  name: "test.wipe",
  title: "Delete every customer",
  description: "Test only.",
  access: "admin",
  effect: "destructive",
  input: z.object({}),
  explain: () => "This deletes every customer and cannot be undone.",
  async run(ctx) {
    await ctx.db.delete(customers);
    return { done: true };
  },
});

describe("operations", () => {
  let handle: DbHandle;
  let owner: Caller;
  let staff: Caller;
  let viewer: Caller;

  beforeAll(async () => {
    handle = await openEmbedded();
    const make = async (
      role: "owner" | "staff" | "viewer",
    ): Promise<Caller> => {
      const id = newId("usr");
      await handle.db
        .insert(users)
        .values({ id, email: `${role}@example.co.nz`, name: role, role });
      return {
        actor: { type: "human", userId: id, name: role, role },
        via: "ui",
        confirmed: true,
      };
    };
    owner = await make("owner");
    staff = await make("staff");
    viewer = await make("viewer");
  });
  afterAll(async () => {
    onEventsCommitted(null);
    await handle.close();
  });

  const run = {
    get db() {
      return handle.db;
    },
  };

  it("checks the input before anything else, field by field", async () => {
    const error = await execute(
      addCustomer,
      { email: "nope" },
      staff,
      run,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OpError);
    expect((error as OpError).code).toBe("invalid_input");
    expect((error as OpError).fields.email).toMatch(/doesn't look right/);
  });

  it("lets a viewer read and refuses them a write", async () => {
    expect(await execute(countCustomers, {}, viewer, run)).toBe(0);
    await expect(
      execute(addCustomer, { email: "a@example.co.nz" }, viewer, run),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps owner-only things to owners", async () => {
    await expect(execute(wipe, {}, staff, run)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("writes the change, the activity line and the event together", async () => {
    const seen: string[][] = [];
    onEventsCommitted((ids) => seen.push([...ids]));

    const { id } = await execute(
      addCustomer,
      { email: "b@example.co.nz" },
      staff,
      { ...run, now: new Date("2026-11-12T08:00:00Z") },
    );

    const [line] = await handle.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, id));
    expect(line).toMatchObject({
      actorType: "human",
      actorName: "staff",
      via: "ui",
      operation: "test.addCustomer",
      entityType: "customer",
      summary: "Added b@example.co.nz",
    });
    expect(line?.at.toISOString()).toBe("2026-11-12T08:00:00.000Z");

    const [event] = await handle.db
      .select()
      .from(events)
      .where(eq(events.entityId, id));
    expect(event?.type).toBe("customer.added");
    expect(event?.processedAt).toBeNull();
    // The dispatcher is told only after the transaction has committed.
    expect(seen).toEqual([[event?.id]]);
  });

  it("leaves nothing behind when the operation throws", async () => {
    const seen: string[][] = [];
    onEventsCommitted((ids) => seen.push([...ids]));
    const before = await execute(countCustomers, {}, viewer, run);
    const linesBefore = (await handle.db.select().from(auditLog)).length;
    const eventsBefore = (await handle.db.select().from(events)).length;

    await expect(
      execute(
        addCustomer,
        { email: "c@example.co.nz", fail: true },
        staff,
        run,
      ),
    ).rejects.toThrow("it broke");

    expect(await execute(countCustomers, {}, viewer, run)).toBe(before);
    expect((await handle.db.select().from(auditLog)).length).toBe(linesBefore);
    expect((await handle.db.select().from(events)).length).toBe(eventsBefore);
    expect(seen).toEqual([]);
  });

  it("adds an activity line even when the operation forgets to", async () => {
    await execute(
      addCustomer,
      { email: "d@example.co.nz", quiet: true },
      staff,
      run,
    );
    const [latest] = await handle.db
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(5)
      .then((rows) => rows.filter((row) => row.summary === "Add a customer"));
    expect(latest?.operation).toBe("test.addCustomer");
  });

  it("will not do something that cannot be undone until someone says yes", async () => {
    const asked = await execute(
      wipe,
      {},
      { ...owner, confirmed: false },
      run,
    ).catch((caught: unknown) => caught);
    expect(asked).toMatchObject({
      code: "needs_confirmation",
      message: "This deletes every customer and cannot be undone.",
    });
    expect(await execute(countCustomers, {}, viewer, run)).toBeGreaterThan(0);

    await execute(wipe, {}, owner, run);
    expect(await execute(countCustomers, {}, viewer, run)).toBe(0);
  });

  it("records the system as the system, with no user", async () => {
    const { id } = await execute(
      addCustomer,
      { email: "e@example.co.nz" },
      systemCaller("The shop", "storefront"),
      run,
    );
    const [line] = await handle.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, id));
    expect(line).toMatchObject({
      actorType: "system",
      actorId: null,
      actorName: "The shop",
      via: "storefront",
    });
  });

  it("can describe itself to a caller that has never seen the code", () => {
    const described = describeOp(addCustomer);
    expect(described).toMatchObject({
      name: "test.addCustomer",
      access: "write",
      effect: "none",
    });
    expect(JSON.stringify(described.input)).toContain('"email"');
  });

  it("refuses a badly named operation at definition time", () => {
    expect(() =>
      defineOp({
        name: "Bad Name",
        title: "x",
        description: "x",
        access: "read",
        input: z.object({}),
        run: async () => null,
      }),
    ).toThrow(/not an operation name/);
  });
});
