/**
 * The line across the top of the shop, from the back end.
 *
 * The site ships with a line of its own (TICKER in content/site.ts). This
 * lets other words be put there with no deploy, the way a landing page has
 * its words: a DRAFT that changes nothing a customer can see, and what is
 * PUBLISHED, which is what the shop shows. Publishing is the only way words
 * get out. It is an outward operation, it needs a yes, and it runs the copy
 * rules over the finished words first: a banned term refuses it, and a
 * restricted one needs a person to have ticked that they read the warning.
 *
 * A yes is for the words that were on the screen. Publishing is handed the
 * lines it was shown and refuses if they are not the draft any more.
 *
 * The rules read the lines the way the band runs them: one after another,
 * and round to the first again. Two lines that are each fine can make a
 * sentence that is not.
 *
 * Putting the site's own line back is one press. The words that were up are
 * kept as the draft, so nothing typed is lost.
 *
 * It is kept in one `settings` row, and only what the back end changed is
 * in it: with no row, or one that cannot be read, the shop shows its own
 * line.
 */

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { TICKER } from "@/content/site";
import { settings, type CopyCheck } from "@/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import {
  sameTopLines,
  tidyTopLines,
  TOP_LINE_LETTERS,
  TOP_LINE_MOST,
  topLineProblems,
} from "@/lib/shop/top-line";

import { refuseUnsendable } from "../core/copy";
import { conflict } from "../core/errors";
import { defineOp, type OpContext } from "../core/op";
import { copyVerdict, type CopyVerdict } from "../marketing/copy-check";
import {
  checkPublicCopy,
  refuseBanned,
  requireRestrictedRead,
} from "../marketing/gate";
import {
  acknowledgeRestricted,
  refuseIfMoved,
  userIdOf,
} from "../marketing/shared";

/** The one row the line is kept in. */
export const TOP_LINE_KEY = "shop.top_line";

/** What the activity log files a change to the line under. */
export const TOP_LINE_ENTITY = { type: "shop", id: "top-line" } as const;

/**
 * A draft may be longer than what can be published, so that nothing typed
 * is thrown away for being a letter over: the screen says what does not fit
 * and the draft waits. These are only the ceilings past which it is not a
 * line of words at all.
 */
const DRAFT_ROWS = 40;
const DRAFT_LETTERS = 400;

const draftLines = z
  .array(z.string().min(1).max(DRAFT_LETTERS))
  .min(1)
  .max(DRAFT_ROWS);
const publishedLines = z
  .array(z.string().min(1).max(TOP_LINE_LETTERS))
  .min(1)
  .max(TOP_LINE_MOST);

const storedSchema = z.object({
  /** Null when the draft is what the shop shows. */
  draft: draftLines.nullable().default(null),
  /** Null when the shop shows the site's own line. */
  published: publishedLines.nullable().default(null),
  publishedAt: z.iso.datetime().nullable().default(null),
  publishedBy: z.string().nullable().default(null),
});

export type TopLineStored = z.infer<typeof storedSchema>;

const NOTHING: TopLineStored = {
  draft: null,
  published: null,
  publishedAt: null,
  publishedBy: null,
};

export type HeldTopLine = {
  readonly stored: TopLineStored;
  /** Exactly what the row holds, or `undefined` when there is no row. */
  readonly raw: unknown;
};

/** What is kept about the line, and exactly as it is kept. */
export async function holdTopLine(db: DbOrTx): Promise<HeldTopLine> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, TOP_LINE_KEY));
  if (row === undefined) return { stored: NOTHING, raw: undefined };
  const read = storedSchema.safeParse(row.value);
  // Something stored that cannot be read is nothing stored: the shop shows
  // its own line, and the next save writes over it.
  return { stored: read.success ? read.data : NOTHING, raw: row.value };
}

/**
 * Write the row, for a change made to exactly what was read: the write only
 * lands if the row still holds what `held` saw, and is refused if somebody
 * else has written since.
 *
 * What is compared is the row's own contents and not the moment it was
 * written: two writes can share a moment, and a write that slipped in
 * between would then go unseen.
 */
export async function writeTopLine(
  db: DbOrTx,
  held: HeldTopLine,
  next: TopLineStored,
  stamp: { readonly now: Date; readonly by: string | null },
): Promise<void> {
  const row = { value: next, updatedAt: stamp.now, updatedBy: stamp.by };
  const written =
    held.raw === undefined
      ? await db
          .insert(settings)
          .values({ key: TOP_LINE_KEY, ...row })
          .onConflictDoNothing()
          .returning({ key: settings.key })
      : await db
          .update(settings)
          .set(row)
          .where(
            and(eq(settings.key, TOP_LINE_KEY), eq(settings.value, held.raw)),
          )
          .returning({ key: settings.key });
  refuseIfMoved(written, "The line across the top");
}

const hold = (db: DbOrTx) => holdTopLine(db);
const keep = (ctx: OpContext, held: HeldTopLine, next: TopLineStored) =>
  writeTopLine(ctx.db, held, next, { now: ctx.now, by: userIdOf(ctx) });

const fileLines = (): string[] => [...TICKER];

/** The lines as the activity log says them: "One" · "Two". */
const said = (lines: readonly string[]) =>
  lines.map((line) => `"${line}"`).join(" · ");

/**
 * The lines as a visitor reads them: one after another, and round to the
 * first again, because the band has no end. A phrase can start on one line
 * and finish on the next, the last line and the first included. So the
 * rules are shown the whole run, and never a line at a time: two lines that
 * are each fine can make a sentence that is not.
 */
function asTheBandRuns(lines: readonly string[]): string {
  const [first] = lines;
  return first === undefined ? "" : [...lines, first].join(" ");
}

/** What the copy rules make of a set of lines, read the way the band runs. */
const check = (db: DbOrTx, lines: readonly string[], now: Date) =>
  checkPublicCopy(db, [asTheBandRuns(lines)], now);

/* ---- reading ------------------------------------------------------------- */

export type TopLineState = {
  /** What the shop shows across the top right now. */
  readonly showing: readonly string[];
  /** True when that is the site's own line, with nothing published over it. */
  readonly standard: boolean;
  /** The site's own line, which "put the standard line back" goes back to. */
  readonly file: readonly string[];
  /** The draft: what the editor holds. The same as `showing` until changed. */
  readonly draft: readonly string[];
  /** True when the draft is not what the shop shows. */
  readonly changed: boolean;
  /** What stops the draft fitting, as sentences. None when it fits. */
  readonly problems: readonly string[];
  /** What the copy rules make of the draft, checked as this was read. */
  readonly copyCheck: CopyCheck;
  readonly verdict: CopyVerdict;
  /** When the line now showing was published. Null for the site's own. */
  readonly publishedAt: Date | null;
};

export const shopTopLine = defineOp({
  name: "shop.topLine",
  title: "The line across the top of the shop",
  description:
    "The line of words that runs across the top of the shop, on every page a visitor lands on: what it says now, whether that is the site's own line or one published from the back end, the draft being worked on, anything that stops the draft fitting, and what the copy check makes of it.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<TopLineState> {
    const { stored } = await hold(ctx.db);
    const file = fileLines();
    const showing = stored.published ?? file;
    const draft = stored.draft ?? showing;
    const copyCheck = await check(ctx.db, draft, ctx.now);
    return {
      showing,
      standard: stored.published === null,
      file,
      draft,
      changed: !sameTopLines(draft, showing),
      problems: topLineProblems(draft),
      copyCheck,
      verdict: copyVerdict(copyCheck),
      publishedAt:
        stored.published === null || stored.publishedAt === null
          ? null
          : new Date(stored.publishedAt),
    };
  },
});

export const topLineNow = defineOp({
  name: "shop.topLineNow",
  title: "The line the shop draws across the top",
  description:
    "For the shop itself, as it draws a page: the lines published from the back end, or nothing when the shop shows the site's own line.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<{ lines: readonly string[] | null }> {
    const { stored } = await hold(ctx.db);
    return { lines: stored.published };
  },
});

/* ---- changing ------------------------------------------------------------ */

/** What was typed, before it is tidied: a row to a line. */
const typedLines = z
  .array(
    z.string().max(DRAFT_LETTERS * 2, "That is too long for a line of words"),
  )
  .max(DRAFT_ROWS * 2, "That is too many lines")
  .transform((rows) => tidyTopLines(rows))
  .refine(
    (lines) => lines.length <= DRAFT_ROWS,
    `That is too many lines. The shop shows ${String(TOP_LINE_MOST)} at most`,
  )
  .refine(
    (lines) => lines.every((line) => line.length <= DRAFT_LETTERS),
    `One of those is far too long for a line. The shop shows ${String(TOP_LINE_LETTERS)} letters at most`,
  );

export const saveTopLine = defineOp({
  name: "shop.saveTopLine",
  title: "Change the draft of the line across the top",
  description:
    "Changes the draft of the line of words that runs across the top of the shop: `lines` is the whole draft, one entry a line, in the order they run. Nothing a customer sees changes until a person publishes it. An empty list puts the draft back to what the shop shows. The answer says what the copy check makes of the words and whether they fit.",
  access: "write",
  input: z.object({ lines: typedLines }),
  async run(
    ctx,
    input,
  ): Promise<{
    verdict: CopyVerdict;
    problems: readonly string[];
    changed: boolean;
  }> {
    const held = await hold(ctx.db);
    const showing = held.stored.published ?? fileLines();
    const was = held.stored.draft ?? showing;
    // An empty box, or the words the shop already shows, is no draft.
    const draft =
      input.lines.length === 0 || sameTopLines(input.lines, showing)
        ? null
        : input.lines;
    const next = draft ?? showing;
    const answer = async () => ({
      verdict: copyVerdict(await check(ctx.db, next, ctx.now)),
      problems: topLineProblems(next),
      changed: draft !== null,
    });
    if (sameTopLines(next, was)) {
      ctx.nothingChanged();
      return answer();
    }
    await keep(ctx, held, { ...held.stored, draft });
    await ctx.audit({
      entity: TOP_LINE_ENTITY,
      summary:
        draft === null
          ? "Put the draft of the line across the top back to what the shop shows"
          : "Changed the draft of the line across the top of the shop. The shop is unchanged",
      data: { draft: next },
    });
    return answer();
  },
});

/** The words the person was looking at when they said yes. */
const shownLines = z
  .array(z.string().max(DRAFT_LETTERS))
  .min(1, "Which words? Open the screen again and have another look")
  .max(DRAFT_ROWS);

const MOVED =
  "The draft changed while you were looking at it. Have another look, then publish it.";

export const publishTopLine = defineOp({
  name: "shop.publishTopLine",
  title: "Publish the line across the top",
  description:
    "Puts the draft's words across the top of the shop, on every page a visitor lands on. `lines` is the draft as it was shown, and it is refused if the draft is something else by now. The copy check has to pass first: a banned term refuses it, and a restricted one needs a person to have read the warning.",
  access: "write",
  effect: "outward",
  input: z.object({ lines: shownLines, acknowledgeRestricted }),
  explain: (input) =>
    `This puts these words across the top of the shop, where every visitor reads them: ${said(input.lines)}. Somebody should have read them first.`,
  async run(ctx, input): Promise<{ lines: readonly string[] }> {
    const held = await hold(ctx.db);
    const showing = held.stored.published ?? fileLines();
    const draft = held.stored.draft;
    if (draft === null) {
      // No draft: the words on the screen were the ones the shop shows.
      if (!sameTopLines(input.lines, showing)) throw conflict(MOVED);
      ctx.nothingChanged();
      return { lines: showing };
    }
    if (!sameTopLines(input.lines, draft)) throw conflict(MOVED);

    const problems = topLineProblems(draft);
    if (problems.length > 0) {
      throw conflict(
        `This line cannot be published as it stands. ${problems.join(" ")}`,
      );
    }
    const copyCheck = await check(ctx.db, draft, ctx.now);
    refuseBanned(copyCheck, "This line", "published");
    const read = requireRestrictedRead(
      copyCheck,
      input.acknowledgeRestricted,
      ctx.actor,
    );
    // The last look, by the same rules everything that leaves the back end
    // is held to, on the very words about to go out.
    refuseUnsendable(
      { "the line across the top": asTheBandRuns(draft) },
      { checked: read },
    );

    const published = publishedLines.parse(draft);
    // The site's own words typed back in and published are the site's own
    // line again, and are kept as that: nothing of the back end's is up.
    const standard = sameTopLines(published, fileLines());
    await keep(
      ctx,
      held,
      standard
        ? NOTHING
        : {
            draft: null,
            published,
            publishedAt: ctx.now.toISOString(),
            publishedBy: userIdOf(ctx),
          },
    );
    await ctx.audit({
      entity: TOP_LINE_ENTITY,
      summary: standard
        ? "Put the standard line back across the top of the shop"
        : `Published the line across the top of the shop: ${said(published)}${read.length === 0 ? "" : `, having read the warnings (${read.join(", ")})`}`,
      data: { lines: published, was: showing, restrictedRead: read },
    });
    await ctx.emit({
      type: "shop.line_changed",
      entity: TOP_LINE_ENTITY,
      payload: { standard },
    });
    return { lines: published };
  },
});

export const resetTopLine = defineOp({
  name: "shop.resetTopLine",
  title: "Put the standard line back across the top",
  description:
    "Takes the words published from the back end off the top of the shop and puts the site's own line back. The words that were up are kept as the draft, unless another draft is being worked on.",
  access: "write",
  effect: "outward",
  input: z.object({}),
  explain: () =>
    `This takes your words off the top of the shop and puts the site's own line back: ${said(TICKER)}.`,
  async run(ctx): Promise<{ lines: readonly string[] }> {
    const held = await hold(ctx.db);
    const file = fileLines();
    const was = held.stored.published;
    if (was === null) {
      ctx.nothingChanged();
      return { lines: file };
    }
    // What was up becomes the draft, so it can go back up as it was. A
    // draft already being worked on is left alone, and one that is the
    // site's own line is no draft.
    const kept = held.stored.draft ?? was;
    await keep(ctx, held, {
      draft: sameTopLines(kept, file) ? null : kept,
      published: null,
      publishedAt: null,
      publishedBy: null,
    });
    await ctx.audit({
      entity: TOP_LINE_ENTITY,
      summary: "Put the standard line back across the top of the shop",
      data: { was },
    });
    await ctx.emit({
      type: "shop.line_changed",
      entity: TOP_LINE_ENTITY,
      payload: { standard: true },
    });
    return { lines: file };
  },
});
