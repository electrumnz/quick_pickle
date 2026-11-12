/**
 * Landing pages: the one page, with different words at the top, for one
 * audience or one advert. /for/<slug>.
 *
 * A page has two sets of words. The DRAFT is what is being worked on; saving
 * it changes nothing a customer can see. PUBLISHED is what the public reads.
 * Publishing copies the draft across, and it is the only way words get out:
 * it is an outward operation, it needs a yes, and it runs the copy rules
 * over the finished text first. A banned term refuses it. A restricted one
 * needs a person to have ticked that they read the warning. So a health
 * claim cannot reach a landing page any more than it can reach the site.
 *
 * A page's address is for ever, like a short link's: it may be printed, or
 * be the target of an advert that is still running. It can be taken down
 * (switched off), and a visitor then lands on the standard page.
 */

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { pages, type PageWords } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { HOME } from "@/lib/shop/routing";

import { refuseUnsendable } from "../core/copy";
import { conflict, notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import { copyVerdict, type CopyVerdict } from "../marketing/copy-check";
import {
  checkPublicCopy,
  refuseBanned,
  requireRestrictedRead,
} from "../marketing/gate";
import { SLUG_PATTERN } from "../marketing/links";
import {
  acknowledgeRestricted,
  recordId,
  refuseIfMoved,
  userIdOf,
} from "../marketing/shared";

type Page = typeof pages.$inferSelect;

/* ---- the words ----------------------------------------------------------- */

/** The headline is set very large. More than this and it will not fit. */
export const HEADLINE_LINES = 4;
export const HEADLINE_LINE_LENGTH = 18;

/** One or more spaces to one; no blank lines; nothing at either end. */
function tidyLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

const oneLine = (max: number, tooLong: string) =>
  z
    .string()
    .max(max * 4)
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .refine((value) => value.length <= max, tooLong);

const eyebrowField = oneLine(32, "Keep the small heading under 32 letters");
const headlineField = z
  .string()
  .max(600)
  .transform(tidyLines)
  .superRefine((headline, ctx) => {
    const lines = headline === "" ? [] : headline.split("\n");
    if (lines.length === 0) {
      ctx.addIssue({ code: "custom", message: "Give the page a headline" });
    } else if (lines.length > HEADLINE_LINES) {
      ctx.addIssue({
        code: "custom",
        message: `Keep the headline to ${String(HEADLINE_LINES)} lines`,
      });
    } else if (lines.some((line) => line.length > HEADLINE_LINE_LENGTH)) {
      ctx.addIssue({
        code: "custom",
        message: `Keep each line of the headline under ${String(HEADLINE_LINE_LENGTH + 1)} letters. It is set very large`,
      });
    }
  });
const leadField = oneLine(220, "Keep the sentence under it to 220 letters");
const nameField = oneLine(60, "Keep the name under 60 letters").refine(
  (value) => value.length >= 1,
  "Give the page a name",
);
const noteField = z.string().trim().max(500, "Keep the note under 500 letters");
const slugField = z
  .string()
  .max(80)
  .transform((value) => value.trim().toLowerCase())
  .refine(
    (slug) => SLUG_PATTERN.test(slug),
    "An address is 2 to 40 lower-case letters, numbers or hyphens",
  )
  // The standard page goes by this name in the numbers and in who sees
  // which page. A landing page called the same would be counted as it.
  .refine(
    (slug) => slug !== HOME,
    `"${HOME}" is the standard page's own name. Pick another`,
  );

const partsOf = (words: PageWords) => ({
  "the small heading": words.eyebrow,
  "the headline": words.headline,
  "the sentence under it": words.lead,
});

const sameWords = (a: PageWords, b: PageWords | null) =>
  b !== null &&
  a.eyebrow === b.eyebrow &&
  a.headline === b.headline &&
  a.lead === b.lead;

const check = (db: DbOrTx, words: PageWords, now: Date) =>
  checkPublicCopy(db, Object.values(partsOf(words)), now);

/* ---- reading ------------------------------------------------------------- */

/**
 *   draft  never published: nobody outside can see it
 *   live   published and switched on
 *   off    published once, now taken down
 */
export type PageState = "draft" | "live" | "off";

export type PageRow = {
  readonly id: string;
  readonly slug: string;
  /** Its public address on this site: "/for/clubs". */
  readonly path: string;
  readonly name: string;
  readonly note: string;
  readonly state: PageState;
  /** The words being worked on. */
  readonly draft: PageWords;
  /** The words the public sees, if it has ever been published. */
  readonly published: PageWords | null;
  /** True when the draft says something the published page does not. */
  readonly changed: boolean;
  /** What the copy check makes of the draft. */
  readonly verdict: CopyVerdict;
  readonly copyCheck: Page["copyCheck"];
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

function stateOf(page: Pick<Page, "published" | "live">): PageState {
  if (page.published === null) return "draft";
  return page.live ? "live" : "off";
}

function toRow(page: Page): PageRow {
  return {
    id: page.id,
    slug: page.slug,
    path: `/for/${page.slug}`,
    name: page.name,
    note: page.note,
    state: stateOf(page),
    draft: page.draft,
    published: page.published,
    changed: !sameWords(page.draft, page.published),
    verdict: copyVerdict(page.copyCheck),
    copyCheck: page.copyCheck,
    publishedAt: page.publishedAt,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

async function loadPage(db: DbOrTx, id: string): Promise<Page> {
  const [page] = await db.select().from(pages).where(eq(pages.id, id));
  if (page === undefined) throw notFound("That page");
  return page;
}

const entityOf = (id: string) => ({ type: "page", id });

export const listPages = defineOp({
  name: "pages.list",
  title: "List landing pages",
  description:
    "Every landing page, by name: its address (/for/<slug>), whether it is a draft, live or taken down, the words being worked on and the words the public sees, whether the two differ, and what the copy check makes of the draft. A landing page is the shop's one page with different words at the top, for one audience or advert.",
  access: "read",
  input: z.object({ limit: z.number().int().min(1).max(200).default(100) }),
  async run(ctx, input): Promise<PageRow[]> {
    const rows = await ctx.db
      .select()
      .from(pages)
      .orderBy(asc(pages.name), asc(pages.id))
      .limit(input.limit);
    return rows.map(toRow);
  },
});

export const getPage = defineOp({
  name: "pages.get",
  title: "Open one landing page",
  description:
    "One landing page by its id: its address, state, draft words, published words and the copy check on the draft.",
  access: "read",
  input: z.object({ id: recordId }),
  async run(ctx, input): Promise<PageRow> {
    return toRow(await loadPage(ctx.db, input.id));
  },
});

/* ---- changing ------------------------------------------------------------ */

export const createPage = defineOp({
  name: "pages.create",
  title: "Start a landing page",
  description:
    "Starts a landing page as a draft at /for/<slug>. Nobody outside can see it until it is published. `slug` is 2 to 40 lower-case letters, numbers or hyphens and is permanent: it may end up printed or in an advert. `name` is what staff call it. The words are the small heading over the headline, the headline (up to 4 short lines, a line to a line; it is set very large) and the one sentence under it. The copy rules are run over them and the result kept with the draft. Everything else on the page is the shop's own and is the same on every page.",
  access: "write",
  input: z.object({
    slug: slugField,
    name: nameField,
    note: noteField.default(""),
    eyebrow: eyebrowField,
    headline: headlineField,
    lead: leadField,
  }),
  async run(ctx, input): Promise<{ id: string; slug: string; path: string }> {
    const words: PageWords = {
      eyebrow: input.eyebrow,
      headline: input.headline,
      lead: input.lead,
    };
    const id = newId("pag");
    const made = await ctx.db
      .insert(pages)
      .values({
        id,
        slug: input.slug,
        name: input.name,
        note: input.note,
        draft: words,
        copyCheck: await check(ctx.db, words, ctx.now),
        createdBy: userIdOf(ctx),
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .onConflictDoNothing({ target: pages.slug })
      .returning({ id: pages.id });
    if (made.length === 0) {
      throw new OpError(
        "conflict",
        `/for/${input.slug} is already a page. Pick another address, or change that one.`,
        { slug: `/for/${input.slug} is already a page` },
      );
    }
    await ctx.audit({
      entity: entityOf(id),
      summary: `Started the landing page "${input.name}" at /for/${input.slug} (a draft, not published)`,
      data: { slug: input.slug },
    });
    return { id, slug: input.slug, path: `/for/${input.slug}` };
  },
});

export const updatePage = defineOp({
  name: "pages.update",
  title: "Change a landing page's draft",
  description:
    "Changes a landing page's draft words (the small heading, the headline, the sentence under it), its staff name or its note. Leave a field out to keep it. This changes the draft only: what the public sees stays as it was until the page is published again. The copy rules are run over the new words and the result kept. The address cannot be changed.",
  access: "write",
  input: z.object({
    id: recordId,
    name: nameField.optional(),
    note: noteField.optional(),
    eyebrow: eyebrowField.optional(),
    headline: headlineField.optional(),
    lead: leadField.optional(),
  }),
  async run(ctx, input): Promise<{ id: string; verdict: CopyVerdict }> {
    const page = await loadPage(ctx.db, input.id);
    const words: PageWords = {
      eyebrow: input.eyebrow ?? page.draft.eyebrow,
      headline: input.headline ?? page.draft.headline,
      lead: input.lead ?? page.draft.lead,
    };
    const name = input.name ?? page.name;
    const note = input.note ?? page.note;
    const wordsChanged = !sameWords(words, page.draft);
    if (!wordsChanged && name === page.name && note === page.note) {
      ctx.nothingChanged();
      return { id: page.id, verdict: copyVerdict(page.copyCheck) };
    }
    const copyCheck = await check(ctx.db, words, ctx.now);
    await ctx.db
      .update(pages)
      .set({ name, note, draft: words, copyCheck, updatedAt: ctx.now })
      .where(eq(pages.id, page.id));
    await ctx.audit({
      entity: entityOf(page.id),
      summary: wordsChanged
        ? `Changed the draft of the landing page "${name}"${page.published === null ? "" : ". The published page is unchanged"}`
        : `Changed the name or note of the landing page "${name}"`,
      data: { wordsChanged },
    });
    return { id: page.id, verdict: copyVerdict(copyCheck) };
  },
});

export const publishPage = defineOp({
  name: "pages.publish",
  title: "Publish a landing page",
  description:
    "Puts a landing page's draft words where the public can read them, at /for/<slug>, and switches the page on. The copy rules are run over the finished words first: a banned phrase refuses it and names the phrase and the rule, and so does naming a partner who has not agreed in writing to be named. A restricted phrase needs `acknowledgeRestricted: true`, which is a person saying they have read the warning and the wording is right. Publishing a page that is already live replaces its words. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({ id: recordId, acknowledgeRestricted }),
  explain: () =>
    "This puts the draft's words on a public page that anyone with the address can read. Somebody should have read them first.",
  async run(ctx, input): Promise<{ path: string; state: PageState }> {
    const page = await loadPage(ctx.db, input.id);
    if (page.live && sameWords(page.draft, page.published)) {
      ctx.nothingChanged();
      return { path: `/for/${page.slug}`, state: "live" };
    }
    const copyCheck = await check(ctx.db, page.draft, ctx.now);
    refuseBanned(copyCheck, "This page", "published");
    const read = requireRestrictedRead(copyCheck, input.acknowledgeRestricted);
    // The last look, by the same rules everything that leaves the back end
    // is held to, on the very words about to go out.
    refuseUnsendable(partsOf(page.draft), { checked: read });

    // Published for the draft that was just checked, and no other.
    const published = await ctx.db
      .update(pages)
      .set({
        published: page.draft,
        publishedAt: ctx.now,
        publishedBy: userIdOf(ctx),
        live: true,
        copyCheck,
        updatedAt: ctx.now,
      })
      .where(and(eq(pages.id, page.id), eq(pages.updatedAt, page.updatedAt)))
      .returning({ id: pages.id });
    refuseIfMoved(published, `"${page.name}"`);

    const entity = entityOf(page.id);
    await ctx.audit({
      entity,
      summary: `${page.published === null ? "Published" : "Published new words on"} the landing page "${page.name}" at /for/${page.slug}${read.length === 0 ? "" : `, having read the warnings (${read.join(", ")})`}`,
      data: { slug: page.slug, restrictedRead: read },
    });
    await ctx.emit({
      type: "page.published",
      entity,
      payload: { pageId: page.id, slug: page.slug },
    });
    return { path: `/for/${page.slug}`, state: "live" };
  },
});

export const setPageLive = defineOp({
  name: "pages.setLive",
  title: "Take a landing page down, or put it back",
  description:
    "Takes a published landing page down, so its address shows the standard page instead, or puts it back up. Nothing is deleted and its numbers are kept. Putting it back runs the copy rules over its published words again, because the rules may have changed since: a banned phrase refuses it. A page that has never been published cannot be put up: publish it. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({ id: recordId, live: z.boolean() }),
  explain: (input) =>
    input.live
      ? "This puts the page back where anyone with the address can read it."
      : "This takes the page down. Anyone following a link or an advert to it will see the standard page.",
  async run(ctx, input): Promise<{ state: PageState }> {
    const page = await loadPage(ctx.db, input.id);
    if (page.published === null) {
      throw conflict(
        `"${page.name}" has never been published, so there is nothing to ${input.live ? "put up" : "take down"}. Publish it first.`,
      );
    }
    if (page.live === input.live) {
      ctx.nothingChanged();
      return { state: stateOf(page) };
    }
    if (input.live) {
      const copyCheck = await check(ctx.db, page.published, ctx.now);
      refuseBanned(copyCheck, "This page", "put back up");
    }
    await ctx.db
      .update(pages)
      .set({ live: input.live, updatedAt: ctx.now })
      .where(eq(pages.id, page.id));
    const entity = entityOf(page.id);
    await ctx.audit({
      entity,
      summary: input.live
        ? `Put the landing page "${page.name}" back up at /for/${page.slug}`
        : `Took the landing page "${page.name}" down`,
    });
    await ctx.emit({
      type: input.live ? "page.published" : "page.taken_down",
      entity,
      payload: { pageId: page.id, slug: page.slug },
    });
    return { state: input.live ? "live" : "off" };
  },
});

/* ---- what the shop shows ------------------------------------------------- */

export type LivePage =
  | {
      readonly found: true;
      readonly slug: string;
      readonly words: PageWords;
    }
  | {
      readonly found: false;
      /**
       * True when there is such a page but it is not up (never published,
       * or taken down). An advert may still point at it, so the shop shows
       * the standard page there. False: no such page at all.
       */
      readonly known: boolean;
    };

export const resolvePage = defineOp({
  name: "pages.resolve",
  title: "The published words for a landing page",
  description:
    "For the shop: given a slug, the published words of that landing page if it is live, and not found otherwise, with `known` saying whether there is such a page at all (a draft, or one that was taken down) so the shop can show the standard page in its place. It never returns a draft's words. Called by the public /for/<slug> address.",
  access: "read",
  input: z.object({
    slug: z.string().transform((value) => value.trim().toLowerCase()),
  }),
  async run(ctx, input): Promise<LivePage> {
    if (!SLUG_PATTERN.test(input.slug)) return { found: false, known: false };
    const [page] = await ctx.db
      .select({
        slug: pages.slug,
        published: pages.published,
        live: pages.live,
      })
      .from(pages)
      .where(eq(pages.slug, input.slug));
    if (page === undefined) return { found: false, known: false };
    if (!page.live || page.published === null) {
      return { found: false, known: true };
    }
    return { found: true, slug: page.slug, words: page.published };
  },
});

/** True when a slug names a page of ours, whatever state it is in. */
export async function isPageSlug(db: DbOrTx, slug: string): Promise<boolean> {
  if (!SLUG_PATTERN.test(slug)) return false;
  const [page] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(eq(pages.slug, slug));
  return page !== undefined;
}

/** Every operation in the area, for a registry to pick up in one go. */
export const PAGES_OPS = [
  listPages,
  getPage,
  createPage,
  updatePage,
  publishPage,
  setPageLive,
  resolvePage,
] as const;
