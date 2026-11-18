import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, events, settings, users } from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import {
  FILMS_ENTITY,
  FILMS_KEY,
  filmsNow,
  shopFilms,
  showFilms,
} from "@/lib/backstage/shop/films";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import { getStore } from "@/lib/shop/store";

/**
 * The promo films on the shop, switched on from the back end. Nothing a
 * customer sees changes until a person has chosen, so most of what is held
 * here is that gate: everything starts off, a yes is for what was on the
 * screen, only films the shop has can be named, and the shop only ever
 * plays what was chosen.
 */

const shop = systemCaller("The shop", "storefront");

describe("the films on the shop", () => {
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

  const state = () => execute(shopFilms, {}, viewer);
  /** What the shop itself is told to play. */
  const playing = async () => (await execute(filmsNow, {}, shop)).keys;
  const show = (on: string[], shown: string[], caller: Caller = staff) =>
    execute(showFilms, { on, shown }, caller);
  const history = async () =>
    (
      await handle.db
        .select({ summary: auditLog.summary })
        .from(auditLog)
        .where(eq(auditLog.entityId, FILMS_ENTITY.id))
    ).map((row) => row.summary);
  const raised = async () =>
    (
      await handle.db
        .select({ payload: events.payload })
        .from(events)
        .where(eq(events.type, "shop.films_changed"))
    ).map((row) => row.payload);
  const stored = async () =>
    (
      await handle.db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, FILMS_KEY))
    )[0]?.value;

  it("starts with every film off, and nothing kept", async () => {
    const now = await state();
    expect(now.on).toEqual([]);
    expect(now.changedAt).toBeNull();
    expect(now.films.length).toBeGreaterThan(0);
    expect(now.films.every((film) => !film.on)).toBe(true);
    expect(await playing()).toEqual([]);
    expect(await getStore({ NODE_ENV: "test" }).currentFilms?.()).toEqual([]);
    expect(await stored()).toBeUndefined();
  });

  it("is not for somebody who can only look", async () => {
    await expect(show(["the-face"], [], viewer)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await playing()).toEqual([]);
  });

  it("only takes films the shop has", async () => {
    await expect(show(["a-film-nobody-made"], [])).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(await playing()).toEqual([]);
  });

  it("puts on what was ticked, in the catalogue's order, and says so", async () => {
    const saved = await show(["eau-de-pickle", "the-face", "the-face"], []);
    expect(saved).toEqual({ on: ["the-face", "eau-de-pickle"], changed: true });
    expect(await playing()).toEqual(["the-face", "eau-de-pickle"]);
    expect(await getStore({ NODE_ENV: "test" }).currentFilms?.()).toEqual([
      "the-face",
      "eau-de-pickle",
    ]);
    const now = await state();
    expect(now.on).toEqual(["the-face", "eau-de-pickle"]);
    expect(now.changedAt).toBeInstanceOf(Date);
    expect(now.films.filter((film) => film.on).map((film) => film.key)).toEqual(
      ["the-face", "eau-de-pickle"],
    );
    expect(await history()).toEqual([
      'Films on the shop are now "The Face", "Eau de pickle". Put on "The Face", "Eau de pickle"',
    ]);
    // The kept pages are thrown away, so the shop shows it at once.
    expect(await raised()).toEqual([{ on: ["the-face", "eau-de-pickle"] }]);
  });

  it("is a yes for what was on the screen, and nothing else", async () => {
    // Somebody looked when nothing was on, and somebody else has since
    // put two on: the first person's save would take them off unseen.
    await expect(show(["lucky"], [])).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await playing()).toEqual(["the-face", "eau-de-pickle"]);
  });

  it("changes nothing, and writes nothing down, for the same choice", async () => {
    const before = (await history()).length;
    const saved = await show(
      ["eau-de-pickle", "the-face"],
      ["the-face", "eau-de-pickle"],
    );
    expect(saved).toEqual({
      on: ["the-face", "eau-de-pickle"],
      changed: false,
    });
    expect(await history()).toHaveLength(before);
    expect(await raised()).toHaveLength(1);
  });

  it("takes off what is unticked, and every film at once", async () => {
    await show(["the-face", "lucky"], ["the-face", "eau-de-pickle"]);
    expect(await playing()).toEqual(["lucky", "the-face"]);
    expect((await history()).at(-1)).toBe(
      'Films on the shop are now "Lucky", "The Face". Put on "Lucky". Took off "Eau de pickle"',
    );
    await show([], ["lucky", "the-face"]);
    expect(await playing()).toEqual([]);
    expect((await history()).at(-1)).toBe("Took every film off the shop");
    expect((await raised()).at(-1)).toEqual({ on: [] });
  });

  it("forgets a film the shop no longer has, and reads nonsense as none", async () => {
    await handle.db
      .update(settings)
      .set({ value: { on: ["lucky", "a-film-taken-out"], changedAt: null } })
      .where(eq(settings.key, FILMS_KEY));
    expect(await playing()).toEqual(["lucky"]);
    expect((await state()).on).toEqual(["lucky"]);
    await handle.db
      .update(settings)
      .set({ value: { on: "everything" } })
      .where(eq(settings.key, FILMS_KEY));
    expect(await playing()).toEqual([]);
    // And the next change writes over it.
    await show(["lucky"], []);
    expect(await playing()).toEqual(["lucky"]);
  });
});
