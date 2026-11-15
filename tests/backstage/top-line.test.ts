import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TICKER } from "@/content/site";
import { auditLog, events, settings, users } from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { addPartner } from "@/lib/backstage/marketing/partners";
import {
  publishTopLine,
  resetTopLine,
  saveTopLine,
  shopTopLine,
  TOP_LINE_ENTITY,
  TOP_LINE_KEY,
  topLineNow,
} from "@/lib/backstage/shop/top-line";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import { getStore } from "@/lib/shop/store";
import { TOP_LINE_LETTERS, TOP_LINE_MOST } from "@/lib/shop/top-line";

/**
 * The line of words across the top of the shop, changed from the back end.
 * The words are typed by a person, so most of what is held here is the gate
 * between a draft and the public: what cannot be published, that a yes is
 * for the words that were on the screen, and that the shop only ever shows
 * what was published.
 */

const shop = systemCaller("The shop", "storefront");
const FILE = [...TICKER];
const MINE = ["Batch 002 is in", "Tiny package, big dill"];

/* copy-audit-ignore-start: wording that breaks the rules on purpose, to prove the line cannot be published with it */
const A_CLAIM = "No more cramps in the second half";
/* copy-audit-ignore-end */

describe("the line across the top of the shop", () => {
  let handle: DbHandle;
  let staff: Caller;
  let viewer: Caller;

  beforeAll(async () => {
    handle = await openEmbedded();
    useDbHandle(handle);
    const make = async (role: "staff" | "viewer"): Promise<Caller> => {
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
    staff = await make("staff");
    viewer = await make("viewer");
  });
  afterAll(async () => {
    await closeDb();
  });

  const state = () => execute(shopTopLine, {}, viewer);
  /** What the shop itself is told to draw: null is its own line. */
  const drawn = async () => (await execute(topLineNow, {}, shop)).lines;
  const save = (lines: string[], caller: Caller = staff) =>
    execute(saveTopLine, { lines }, caller);
  const publish = (
    lines: readonly string[],
    over: { acknowledgeRestricted?: boolean; caller?: Caller } = {},
  ) =>
    execute(
      publishTopLine,
      {
        lines: [...lines],
        ...(over.acknowledgeRestricted === undefined
          ? {}
          : { acknowledgeRestricted: over.acknowledgeRestricted }),
      },
      over.caller ?? staff,
    );
  const history = async () =>
    (
      await handle.db
        .select({ summary: auditLog.summary })
        .from(auditLog)
        .where(eq(auditLog.entityId, TOP_LINE_ENTITY.id))
    ).map((row) => row.summary);
  const raised = async () =>
    (
      await handle.db
        .select({ payload: events.payload })
        .from(events)
        .where(eq(events.type, "shop.line_changed"))
    ).map((row) => row.payload);
  const stored = async () =>
    (
      await handle.db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, TOP_LINE_KEY))
    )[0]?.value;

  it("is the site's own line until somebody publishes another", async () => {
    expect(await state()).toMatchObject({
      showing: FILE,
      standard: true,
      file: FILE,
      draft: FILE,
      changed: false,
      // The line the site ships with fits, and passes its own rules.
      problems: [],
      verdict: "clean",
      publishedAt: null,
    });
    expect(await drawn()).toBeNull();
    expect(await getStore({ NODE_ENV: "test" }).currentTopLine?.()).toBeNull();
    // Nothing is kept until something is changed.
    expect(await stored()).toBeUndefined();
  });

  it("keeps a draft that no customer can see", async () => {
    const saved = await save([
      "  Batch   002 is in ",
      "",
      "Tiny package, big dill",
    ]);
    expect(saved).toEqual({ verdict: "clean", problems: [], changed: true });
    expect(await state()).toMatchObject({
      // Tidied: spaces squeezed, the empty row dropped.
      draft: MINE,
      changed: true,
      standard: true,
      showing: FILE,
    });
    expect(await drawn()).toBeNull();
    expect(await raised()).toEqual([]);
    expect(await history()).toEqual([
      "Changed the draft of the line across the top of the shop. The shop is unchanged",
    ]);

    // Saving the same words again writes nothing down.
    await save(MINE);
    expect(await history()).toHaveLength(1);
  });

  it("keeps a draft that does not fit, says why, and will not publish it", async () => {
    const long = "x".repeat(TOP_LINE_LETTERS + 1);
    const many = Array.from(
      { length: TOP_LINE_MOST + 1 },
      (_, index) => `Line ${String(index + 1)}`,
    );
    const tooLong = await save(["Fine", long]);
    // Nothing typed is thrown away for being a letter over.
    expect(tooLong.problems).toEqual([
      `Line 2 is ${String(TOP_LINE_LETTERS + 1)} letters long. Keep each line to ${String(TOP_LINE_LETTERS)}.`,
    ]);
    expect((await state()).draft).toEqual(["Fine", long]);
    await expect(publish(["Fine", long])).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("cannot be published as it stands"),
    });

    const tooMany = await save(many);
    expect(tooMany.problems).toEqual([
      `There are ${String(TOP_LINE_MOST + 1)} lines. Keep it to ${String(TOP_LINE_MOST)}.`,
    ]);
    await expect(publish(many)).rejects.toMatchObject({ code: "conflict" });
    expect(await drawn()).toBeNull();

    // Past any sense it is not a line of words at all, and is not kept.
    await expect(save(["y".repeat(900)])).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect((await state()).draft).toEqual(many);
  });

  it("cannot be published with a claim in it, whoever asks", async () => {
    const saved = await save([A_CLAIM, "Pickle Crew"]);
    expect(saved.verdict).toBe("banned");
    // The draft is saved: a person can see what the check found and fix it.
    expect(await state()).toMatchObject({
      draft: [A_CLAIM, "Pickle Crew"],
      verdict: "banned",
    });
    for (const acknowledgeRestricted of [false, true]) {
      await expect(
        publish([A_CLAIM, "Pickle Crew"], { acknowledgeRestricted }),
      ).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringContaining("cannot be published"),
      });
    }
    expect(await drawn()).toBeNull();
  });

  it("will not go out with a long dash, or naming a partner without their yes", async () => {
    const dash = ["Sour, salty — and down in one"];
    expect((await save(dash)).verdict).toBe("banned");
    await expect(publish(dash)).rejects.toMatchObject({ code: "conflict" });

    await execute(addPartner, { name: "Rovers FC", kind: "club" }, staff);
    const named = ["The box Rovers FC keep in the shed"];
    expect((await save(named)).verdict).toBe("banned");
    await expect(publish(named)).rejects.toMatchObject({ code: "conflict" });
    expect(await drawn()).toBeNull();
  });

  it("needs a person to have read a warning before wording like it goes out", async () => {
    const offer = ["Free delivery on a box of 24", "Pickle Crew"];
    expect((await save(offer)).verdict).toBe("restricted");
    await expect(publish(offer)).rejects.toMatchObject({
      code: "invalid_input",
      fields: {
        acknowledgeRestricted: expect.stringContaining("second look"),
      },
    });
    // A bot's tick is not a person's, even once a person has said yes to it.
    const bot: Caller = {
      actor: {
        type: "bot",
        userId: staff.actor.type === "system" ? "" : staff.actor.userId,
        name: "Claude, for staff",
        role: "staff",
      },
      via: "mcp",
      confirmed: true,
    };
    await expect(
      publish(offer, { acknowledgeRestricted: true, caller: bot }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await drawn()).toBeNull();

    const out = await publish(offer, { acknowledgeRestricted: true });
    expect(out).toEqual({ lines: offer });
    expect(await drawn()).toEqual(offer);
    expect(await history()).toContain(
      'Published the line across the top of the shop: "Free delivery on a box of 24" · "Pickle Crew", having read the warnings (FTA-06)',
    );
  });

  it("shows the shop what was published, and only that", async () => {
    const offer = ["Free delivery on a box of 24", "Pickle Crew"];
    expect(await state()).toMatchObject({
      showing: offer,
      standard: false,
      draft: offer,
      changed: false,
      file: FILE,
    });
    expect((await state()).publishedAt).toBeInstanceOf(Date);
    expect(await getStore({ NODE_ENV: "test" }).currentTopLine?.()).toEqual(
      offer,
    );
    expect(await raised()).toEqual([{ standard: false }]);

    // Work on the draft: the shop does not move.
    await save(MINE);
    expect(await drawn()).toEqual(offer);
    expect(await state()).toMatchObject({ draft: MINE, changed: true });
    expect(await raised()).toHaveLength(1);
  });

  it("publishes the words that were on the screen, and no others", async () => {
    // Somebody was looking at one draft when another was saved over it.
    await expect(publish(["Batch 001 is in"])).rejects.toMatchObject({
      code: "conflict",
      message:
        "The draft changed while you were looking at it. Have another look, then publish it.",
    });
    expect(await drawn()).not.toEqual(["Batch 001 is in"]);

    expect(await publish(MINE)).toEqual({ lines: MINE });
    expect(await drawn()).toEqual(MINE);
    expect(await state()).toMatchObject({ draft: MINE, changed: false });
    expect(await raised()).toHaveLength(2);

    // Pressed twice, or with nothing new to publish, it writes nothing.
    const before = (await history()).length;
    expect(await publish(MINE)).toEqual({ lines: MINE });
    expect(await history()).toHaveLength(before);
    expect(await raised()).toHaveLength(2);
    // And with no draft, words that are not the shop's are not published.
    await expect(publish(["Something else"])).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("puts the site's own line back in one press, and keeps the words", async () => {
    expect(await execute(resetTopLine, {}, staff)).toEqual({ lines: FILE });
    expect(await drawn()).toBeNull();
    expect(await state()).toMatchObject({
      showing: FILE,
      standard: true,
      // What was up is the draft now, so it can go back up as it was.
      draft: MINE,
      changed: true,
      publishedAt: null,
    });
    expect(await raised()).toEqual([
      { standard: false },
      { standard: false },
      { standard: true },
    ]);
    expect(await history()).toContain(
      "Put the standard line back across the top of the shop",
    );

    // Already back: nothing to do, and nothing written down.
    const before = (await history()).length;
    await execute(resetTopLine, {}, staff);
    expect(await history()).toHaveLength(before);
    expect(await raised()).toHaveLength(3);

    // A draft somebody was part-way through is left alone by it.
    await publish(MINE);
    await save(["Half a thought"]);
    await execute(resetTopLine, {}, staff);
    expect(await state()).toMatchObject({
      standard: true,
      draft: ["Half a thought"],
    });
  });

  it("takes the site's own words, published over another line, as the standard line", async () => {
    await save(MINE);
    await publish(MINE);
    expect((await state()).standard).toBe(false);
    // Typed back in by hand and published, they are not "a line of yours".
    await save(FILE);
    expect((await state()).changed).toBe(true);
    const events = (await raised()).length;
    expect(await publish(FILE)).toEqual({ lines: FILE });
    expect(await state()).toMatchObject({
      standard: true,
      showing: FILE,
      draft: FILE,
      changed: false,
      publishedAt: null,
    });
    expect(await drawn()).toBeNull();
    expect((await raised()).slice(events)).toEqual([{ standard: true }]);
  });

  it("forgets a draft that is put back to what the shop shows", async () => {
    await save(["Half a thought"]);
    expect((await state()).changed).toBe(true);
    // The site's own words typed back in, or an empty box, is no draft.
    expect(await save(FILE)).toMatchObject({ changed: false });
    expect(await state()).toMatchObject({ draft: FILE, changed: false });
    await save(["Half a thought"]);
    expect(await save([])).toMatchObject({ changed: false });
    expect(await state()).toMatchObject({ draft: FILE, changed: false });
    expect(await stored()).toMatchObject({ draft: null, published: null });
  });

  it("is only changed by somebody who may, and only let out by a person's yes", async () => {
    for (const attempt of [
      () => save(MINE, viewer),
      () => publish(MINE, { caller: viewer }),
      () => execute(resetTopLine, {}, viewer),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "forbidden" });
    }
    // A bot may write a draft. Letting words out, or taking them away, is
    // not run for it without a yes.
    const bot: Caller = { ...staff, via: "mcp", confirmed: false };
    await expect(save(MINE, bot)).resolves.toMatchObject({ changed: true });
    await expect(publish(MINE, { caller: bot })).rejects.toMatchObject({
      code: "needs_confirmation",
    });
    await expect(execute(resetTopLine, {}, bot)).rejects.toMatchObject({
      code: "needs_confirmation",
    });
    expect(await drawn()).toBeNull();
  });

  it("shows the site's own line when what is stored cannot be read", async () => {
    await publish(MINE);
    expect(await drawn()).toEqual(MINE);
    // A line longer than the shop can show, put there by something else.
    await handle.db
      .update(settings)
      .set({
        value: {
          published: ["z".repeat(TOP_LINE_LETTERS + 40)],
          draft: null,
        },
      })
      .where(eq(settings.key, TOP_LINE_KEY));
    expect(await drawn()).toBeNull();
    expect(await state()).toMatchObject({ standard: true, showing: FILE });
    // The next change writes over it.
    await save(MINE);
    await publish(MINE);
    expect(await drawn()).toEqual(MINE);
    await execute(resetTopLine, {}, staff);
  });
});
