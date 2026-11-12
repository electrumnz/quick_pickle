import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ALL_OPS,
  areas,
  describeOp,
  findOps,
  inputSchemaOf,
  BOT_MUST_SAY,
  kindOf,
  OFFERED,
  offeredOp,
  PEOPLE_ONLY,
  SYSTEM_ONLY,
  unreadKeys,
} from "@/lib/backstage/connect/catalogue";

/**
 * The list of every operation, and which of them a bot may be offered.
 * An operation added anywhere in the back end has to be in the list, and
 * handing one to a bot has to be something somebody decided.
 */

/** Every operation name written in the source, wherever it is. */
function namesInSource(dir: string): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      names.push(...namesInSource(path));
      continue;
    }
    if (!path.endsWith(".ts")) continue;
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(
      /defineOp\(\{\s*name:\s*"([a-zA-Z]+\.[a-zA-Z]+)"/g,
    )) {
      if (match[1] !== undefined) names.push(match[1]);
    }
  }
  return names;
}

describe("the list of every operation", () => {
  const written = namesInSource(join(process.cwd(), "lib")).sort();

  it("has every operation there is, and each once", () => {
    expect(written.length).toBeGreaterThan(250);
    expect(new Set(written).size).toBe(written.length);
    expect([...ALL_OPS.keys()].sort()).toEqual(written);
  });

  it("holds back only operations that exist", () => {
    for (const name of SYSTEM_ONLY) {
      expect(ALL_OPS.has(name), name).toBe(true);
    }
  });

  it("never offers a bot the system's own work, or an owner's", () => {
    for (const op of OFFERED) {
      expect(SYSTEM_ONLY.has(op.name), op.name).toBe(false);
      expect(op.access, op.name).not.toBe("admin");
    }
    for (const name of [
      // Money is true because a payment processor said so.
      "orders.markPaid",
      "orders.record",
      "orders.refundSettled",
      // Mail that arrived, arrived.
      "mail.ingest",
      // Who can sign in.
      "staff.invite",
      "staff.setPasswordWithToken",
      // A bot does not open the door for itself, or say its own yes.
      "connect.grant",
      "connect.setOn",
      "approvals.begin",
      // An owner's alone.
      "shop.confirm",
      "plans.deleteDocument",
    ]) {
      expect(offeredOp(name), name).toBeNull();
    }
    expect(offeredOp("no.suchThing")).toBeNull();
  });

  it("has not started holding back, or handing over, anything by accident", () => {
    // What is held back, by area. Changing this list is a decision: say so
    // here when it is made.
    const held = [...ALL_OPS.keys()]
      .filter((name) => offeredOp(name) === null)
      .sort();
    const byArea: Record<string, number> = {};
    for (const name of held) {
      const area = name.split(".")[0] ?? "";
      byArea[area] = (byArea[area] ?? 0) + 1;
    }
    expect(byArea).toEqual({
      approvals: 4,
      campaigns: 5,
      clock: 1,
      connect: 11,
      crew: 1,
      limits: 2,
      links: 2,
      mail: 7,
      numbers: 1,
      orders: 8,
      pages: 2,
      plans: 2,
      promoCodes: 3,
      reviews: 1,
      shop: 1,
      specials: 2,
      staff: 6,
    });
    // And the money ones a bot IS offered all wait for a person's yes.
    for (const name of [
      "orders.recordRefund",
      "orders.cancel",
      "orders.markShipped",
      "orders.emailCustomer",
      "mail.send",
      "campaigns.send",
      "shop.change",
      "stock.recallBatch",
    ]) {
      const op = offeredOp(name);
      expect(op, name).not.toBeNull();
      if (op !== null) expect(kindOf(op), name).toBe("ask");
    }
  });

  it("makes everything that reaches a customer wait for a person's yes", () => {
    // None of these sends an email, and each of them reaches a customer
    // all the same: money off at the checkout, where a paid-for box is
    // sent, the words under every reply, who is never written to again,
    // whose mail is never read, what food is on sale. A bot ran each of
    // these by itself until an independent review said so.
    for (const name of [
      "promoCodes.create",
      "promoCodes.update",
      "promoCodes.setActive",
      "promoCodes.setCrewWelcome",
      "orders.updateDelivery",
      "mail.setSignature",
      "mail.suppress",
      "mail.blockContact",
      "morning.set",
      "partners.setPermission",
      "stock.releaseBatch",
      "reviews.unpublish",
      "crew.unsubscribe",
    ]) {
      const op = offeredOp(name);
      expect(op, name).not.toBeNull();
      if (op === null) continue;
      expect(kindOf(op), name).toBe("ask");
      // And each says, in a sentence, what a yes would do.
      expect(op.explain, name).toBeTypeOf("function");
    }
  });

  it("leaves putting saved words in front of customers to a person", () => {
    // Changing this list is a decision: say so here when it is made.
    expect(Object.keys(PEOPLE_ONLY).sort()).toEqual([
      "campaigns.approve",
      "pages.publish",
      "pages.startTest",
      "reviews.add",
      "reviews.publish",
      "social.approve",
      "specials.switchOn",
    ]);
    for (const [name, where] of Object.entries(PEOPLE_ONLY)) {
      const op = offeredOp(name);
      // It is offered, so a bot can be told it is there and whose it is.
      expect(op, name).not.toBeNull();
      if (op === null) continue;
      expect(kindOf(op), name).toBe("person");
      expect(where.length, name).toBeGreaterThan(10);
    }
    // What a bot has to say in so many words names real operations, and
    // real things they take.
    for (const [name, keys] of Object.entries(BOT_MUST_SAY)) {
      const op = offeredOp(name);
      expect(op, name).not.toBeNull();
      if (op === null) continue;
      const takes = inputSchemaOf(op).properties as Record<string, unknown>;
      for (const key of keys)
        expect(takes, `${name}.${key}`).toHaveProperty(key);
    }
  });

  it("says of each what a bot may do with it", () => {
    const kinds = { look: 0, change: 0, ask: 0, person: 0 };
    for (const op of OFFERED) kinds[kindOf(op)] += 1;
    expect(kinds.look).toBeGreaterThan(60);
    expect(kinds.change).toBeGreaterThan(80);
    expect(kinds.ask).toBeGreaterThan(30);
    expect(kinds.person).toBe(Object.keys(PEOPLE_ONLY).length);
    const get = offeredOp("orders.get");
    expect(get === null ? null : kindOf(get)).toBe("look");
    const note = offeredOp("orders.addNote");
    expect(note === null ? null : kindOf(note)).toBe("change");
  });

  it("can say what every one of them takes", () => {
    for (const op of OFFERED) {
      const schema = inputSchemaOf(op);
      expect(schema.type, op.name).toBe("object");
      expect(schema, op.name).not.toHaveProperty("$schema");
      const described = describeOp(op);
      expect(described.description.length, op.name).toBeGreaterThan(20);
      expect(described.summary.length, op.name).toBeGreaterThan(5);
      expect(described.summary.length, op.name).toBeLessThanOrEqual(220);
    }
    // A real one, to the letter.
    const refund = offeredOp("orders.get");
    expect(refund === null ? null : inputSchemaOf(refund)).toMatchObject({
      type: "object",
      required: ["number"],
    });
  });
});

describe("finding an operation by what it does", () => {
  const first = (query: string) => findOps(query)[0]?.name;
  const names = (query: string) => findOps(query).map((each) => each.name);

  it("finds the obvious one for plain words", () => {
    expect(names("refund an order")).toContain("orders.recordRefund");
    expect(names("list orders")).toContain("orders.list");
    expect(names("what needs doing today")).toContain("today.needs");
    expect(names("reply to a customer email")).toContain("mail.send");
    expect(names("how many shots are left in stock")).toContain(
      "stock.picture",
    );
    expect(names("promo code")).toContain("promoCodes.create");
    expect(names("change a price")).toContain("shop.change");
  });

  it("takes a name as it is written, and nothing held back", () => {
    expect(first("orders.markShipped")).toBe("orders.markShipped");
    expect(findOps("orders.markPaid").map((each) => each.name)).not.toContain(
      "orders.markPaid",
    );
    expect(names("mark an order as paid")).not.toContain("orders.markPaid");
    expect(names("invite staff")).not.toContain("staff.invite");
  });

  it("says nothing for nothing, and never more than it was asked for", () => {
    expect(findOps("")).toEqual([]);
    expect(findOps("the of and")).toEqual([]);
    expect(findOps("zzzzqqqq")).toEqual([]);
    expect(findOps("order", 5)).toHaveLength(5);
  });

  it("lays out what there is, area by area", () => {
    const all = areas();
    expect(all.map((each) => each.area)).toContain("orders");
    expect(all.map((each) => each.area)).not.toContain("staff");
    expect(all.reduce((sum, each) => sum + each.count, 0)).toBe(OFFERED.length);
  });
});

describe("what was handed over, against what would be read of it", () => {
  it("names every key that reading drops", () => {
    expect(unreadKeys({ a: 1, b: 2 }, { a: 1 })).toEqual(["b"]);
    // A key spelt nearly right is a different key.
    expect(unreadKeys({ Body: "x", to: "y" }, { to: "y" })).toEqual(["Body"]);
    // Inside, and inside a list.
    expect(
      unreadKeys(
        {
          lines: [
            { sku: "a", qty: 1 },
            { sku: "b", price: 5 },
          ],
        },
        { lines: [{ sku: "a", qty: 1 }, { sku: "b" }] },
      ),
    ).toEqual(["lines[1].price"]);
    expect(
      unreadKeys({ deep: { er: { x: 1 } } }, { deep: { er: {} } }),
    ).toEqual(["deep.er.x"]);
  });

  it("finds nothing where nothing was dropped", () => {
    expect(unreadKeys({}, {})).toEqual([]);
    expect(unreadKeys({ a: 1 }, { a: 1, withADefault: true })).toEqual([]);
    // A key that was read and came to nothing was still read.
    expect(unreadKeys({ a: "" }, { a: undefined })).toEqual([]);
    // Where the shape stops being the same there is nothing to compare.
    expect(unreadKeys({ when: "2026-11-12" }, { when: new Date(0) })).toEqual(
      [],
    );
    expect(unreadKeys({ list: [1, 2, 3] }, { list: [1, 2] })).toEqual([]);
  });

  it("is not fooled by a key that every object has", () => {
    const given = JSON.parse(
      '{"__proto__": {"x": 1}, "constructor": 1}',
    ) as Record<string, unknown>;
    expect(unreadKeys(given, {}).sort()).toEqual(["__proto__", "constructor"]);
  });

  it("holds for every operation a bot is offered: nothing reads past it", () => {
    // Each takes an object and reads it as one, so a key it does not know
    // is always seen to be dropped. An operation that reshaped what it was
    // handed would slip past the comparison, and this is where that shows.
    for (const op of OFFERED) {
      expect(op.input instanceof z.ZodObject, op.name).toBe(true);
      const read = op.input.safeParse({ notAThingAnythingTakes: 1 });
      if (!read.success) continue;
      expect(
        unreadKeys({ notAThingAnythingTakes: 1 }, read.data),
        op.name,
      ).toEqual(["notAThingAnythingTakes"]);
    }
  });
});
