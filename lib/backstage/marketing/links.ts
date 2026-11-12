/**
 * Tracked short links: /go/<slug>.
 *
 * A short address of ours for a bio, a post or a flyer's QR code. Following
 * it passes the visitor on to where it points, with the link's utm labels
 * added so the visit says where it came from, and counts one click. Nothing
 * about the visitor is kept: no address, no cookie, just the count.
 *
 * What counts as a click: a GET from something that looks like a person's
 * browser. A HEAD request, a link preview, a search engine and a browser
 * fetching the page ahead of time are not clicks (`isCountedVisit`). The
 * count is added after the redirect has been sent, so a slow or failed count
 * never holds a visitor up. With no cookie and nothing stored about the
 * visitor, the same person following a link twice is two clicks: these are
 * visits, not people.
 *
 * A slug is for ever. It may be printed on a pack or a flyer, so a link can
 * be pointed somewhere new or switched off, but never renamed, deleted or
 * handed to another link.
 *
 * The one thing this must never become is a way to bounce a visitor from our
 * address to anywhere somebody likes. So where a link goes is never read from
 * the request. It is read from the saved record, and it is only ever a page
 * on this site (one leading slash) or a full https address. That is checked
 * when the link is saved and checked again every time it is followed, so even
 * a row changed behind the back end's back cannot send anyone to a
 * `javascript:` address or to `//somewhere-else`.
 */

import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { links } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";

import { can } from "../core/actor";
import { notFound, OpError } from "../core/errors";
import { defineOp, type OpContext } from "../core/op";
import { safeHttpsUrl, safeSitePath } from "./markdown";
import { recordId } from "./shared";

type LinkRecord = typeof links.$inferSelect;

/** Words the site itself answers to. A link may not take one. */
export const RESERVED_SLUGS: readonly string[] = [
  "backstage",
  "api",
  "checkout",
  "order",
  "go",
  "links",
  "_next",
];

/** Two to forty lower-case letters, digits and hyphens, not at either end. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38})[a-z0-9]$/;

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;

/* ---- where a link may go ------------------------------------------------ */

export type LinkTarget = {
  /** path: a page on this site. https: a full address somewhere else. */
  readonly kind: "path" | "https";
  readonly value: string;
};

const isShortLink = (path: string) =>
  path === "/go" || path.startsWith("/go/") || path.startsWith("/go?");

/** Where a link may go, tidied, or null if it may not go there. */
export function safeLinkTarget(raw: string): LinkTarget | null {
  const value = raw.trim();
  const path = safeSitePath(value);
  if (path !== null) {
    // A short link pointing at a short link goes round in a circle.
    return isShortLink(path) ? null : { kind: "path", value: path };
  }
  const https = safeHttpsUrl(value);
  return https === null ? null : { kind: "https", value: https };
}

/** Why a target was turned down, as a sentence. */
function targetProblem(raw: string): string {
  const value = raw.trim();
  if (value === "") return "Say where the link goes";
  if (value.startsWith("//") || value.startsWith("/\\")) {
    return "Two slashes at the start means another website to a browser. Use one slash for a page on this site, or a full https address";
  }
  if (value.startsWith("/")) {
    return isShortLink(value)
      ? "A short link cannot point at another short link"
      : "That does not look like a page on this site";
  }
  if (/^http:/i.test(value)) {
    return "Use an https address. Plain http is not allowed";
  }
  return "A link can go to a page on this site, starting with one slash, or to a full https address. Nothing else";
}

/**
 * Pointing our own address at somebody else's website is an owner's call.
 * Anyone who can write may make a link to a page on this site.
 */
function refuseOutsideTarget(ctx: OpContext, target: string): void {
  if (safeLinkTarget(target)?.kind !== "https") return;
  if (can(ctx.actor, "admin")) return;
  const message =
    "Only an owner can point a short link at another website. A page on this site is fine.";
  throw new OpError("forbidden", message, { target: message });
}

/* ---- what counts as a click --------------------------------------------- */

/**
 * Machines that say what they are: search engines, link previews, uptime
 * checks, scripts. Read from the request to decide whether to count, and
 * never stored. It is a short list on purpose. Missing a machine adds a
 * click or two; mistaking a person for one would hide a real visit. (The
 * one exception written in: "bot" at the end of a word is a machine, except
 * in the name of a make of phone.)
 */
const MACHINE =
  /(?<!cu)bot\b|crawler|spider|slurp|facebookexternalhit|whatsapp\/|preview|embedly|iframely|feedfetcher|mediapartners|googleother|headless|lighthouse|pingdom|uptime|monitor|scrapy|curl\/|wget\/|python-|go-http-client|okhttp|java\/|http\.rb|libwww|node-fetch|undici|axios\/|postman/i;

/** Headers a browser sends when it fetches a page before anyone asked for it. */
const AHEAD_OF_TIME = ["purpose", "sec-purpose", "x-purpose", "x-moz"];

/**
 * True when a request for a short link is a person following it, as far as
 * can be told without keeping anything about them.
 */
export function isCountedVisit(request: {
  readonly method: string;
  readonly headers: { get(name: string): string | null };
}): boolean {
  if (request.method.toUpperCase() !== "GET") return false;
  const agent = (request.headers.get("user-agent") ?? "").trim();
  if (agent === "" || MACHINE.test(agent)) return false;
  return !AHEAD_OF_TIME.some((name) =>
    /prefetch|prerender|preview/i.test(request.headers.get(name) ?? ""),
  );
}

const PLACEHOLDER_ORIGIN = "https://site.invalid";

/** Add the link's utm labels to where it goes, leaving any already there. */
export function withUtm(
  target: LinkTarget,
  utm: Readonly<Record<string, string>>,
): LinkTarget | null {
  const url = new URL(target.value, PLACEHOLDER_ORIGIN);
  for (const key of UTM_KEYS) {
    const value = utm[key];
    if (typeof value !== "string" || value === "") continue;
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  return safeLinkTarget(
    target.kind === "path"
      ? `${url.pathname}${url.search}${url.hash}`
      : url.href,
  );
}

/* ---- fields ------------------------------------------------------------- */

const slugField = z
  .string()
  .max(80)
  .transform((value) => value.trim().toLowerCase())
  .superRefine((slug, ctx) => {
    if (!SLUG_PATTERN.test(slug)) {
      ctx.addIssue({
        code: "custom",
        message:
          "A short address is 2 to 40 lower-case letters, numbers or hyphens",
      });
    } else if (RESERVED_SLUGS.includes(slug)) {
      ctx.addIssue({
        code: "custom",
        message: `"${slug}" is used by the site itself. Pick another`,
      });
    }
  });

const targetField = z
  .string()
  .max(2000, "That address is too long")
  .transform((raw, ctx) => {
    const target = safeLinkTarget(raw);
    if (target === null) {
      ctx.addIssue({ code: "custom", message: targetProblem(raw) });
      return z.NEVER;
    }
    return target.value;
  });

const utmValue = z
  .string()
  .trim()
  .toLowerCase()
  .max(60, "Keep it under 60 letters")
  .regex(
    /^(?:[a-z0-9][a-z0-9._-]*)?$/,
    "Use letters, numbers, dots, hyphens or underscores, with no spaces",
  );
const utmField = z.object({
  source: utmValue.default(""),
  medium: utmValue.default(""),
  campaign: utmValue.default(""),
});

function utmRecord(utm: z.output<typeof utmField>): Record<string, string> {
  const out: Record<string, string> = {};
  if (utm.source !== "") out.utm_source = utm.source;
  if (utm.medium !== "") out.utm_medium = utm.medium;
  if (utm.campaign !== "") out.utm_campaign = utm.campaign;
  return out;
}

const labelField = z.string().trim().max(80, "Keep the label under 80 letters");
const showOrderField = z
  .number({ error: "The order is a whole number, or empty to hide it" })
  .int("The order is a whole number, or empty to hide it")
  .min(1, "The order starts at 1")
  .max(999)
  .nullable();

/* ---- reading ------------------------------------------------------------ */

export type LinkRow = {
  readonly id: string;
  readonly slug: string;
  /** The short address on this site: "/go/insta". */
  readonly path: string;
  readonly target: string;
  /** True when it leaves this site for another website. */
  readonly external: boolean;
  readonly label: string;
  readonly utm: Readonly<Record<string, string>>;
  /** Its place on the public links page. Null: not shown there. */
  readonly showOrder: number | null;
  readonly clicks: number;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

function toRow(link: LinkRecord): LinkRow {
  return {
    id: link.id,
    slug: link.slug,
    path: `/go/${link.slug}`,
    target: link.target,
    external: safeLinkTarget(link.target)?.kind === "https",
    label: link.label,
    utm: link.utm,
    showOrder: link.showOrder,
    clicks: link.clicks,
    active: link.active,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

async function loadLink(db: DbOrTx, id: string): Promise<LinkRecord> {
  const [link] = await db.select().from(links).where(eq(links.id, id));
  if (link === undefined) throw notFound("That link");
  return link;
}

export const listLinks = defineOp({
  name: "links.list",
  title: "List short links",
  description:
    'Our tracked short links (/go/<slug>) with where each goes, whether that is another website (`external`), and how many times it has been followed. `sort` is "newest" or "clicks" (most followed first). `active` narrows to links that are switched on or off. A click is one visit by something that looks like a person\'s browser. Nothing is kept about visitors, so these are visits, not people.',
  access: "read",
  input: z.object({
    active: z.enum(["all", "on", "off"]).default("all"),
    sort: z.enum(["newest", "clicks"]).default("newest"),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  async run(ctx, input): Promise<LinkRow[]> {
    const rows = await ctx.db
      .select()
      .from(links)
      .where(
        input.active === "all"
          ? undefined
          : eq(links.active, input.active === "on"),
      )
      .orderBy(
        ...(input.sort === "clicks"
          ? [desc(links.clicks), desc(links.createdAt)]
          : [desc(links.createdAt), desc(links.id)]),
      )
      .limit(input.limit);
    return rows.map(toRow);
  },
});

/* ---- changing ----------------------------------------------------------- */

export const createLink = defineOp({
  name: "links.create",
  title: "Make a short link",
  description:
    "Makes a tracked short link at /go/<slug>. The slug is 2 to 40 lower-case letters, numbers or hyphens, and cannot be a word the site itself uses. It is permanent: a link can be pointed somewhere new or switched off later, but never renamed or deleted, because the address may be printed. The target is either a page on this site (starting with a single slash, like /checkout) or a full https address; anything else is refused, and only an owner may point a link at another website. `utm` labels (source, medium, campaign) are added to the address on the way through. `showOrder` puts it on the public links page in that position (that page is not built yet). A slug that is taken is refused.",
  access: "write",
  input: z.object({
    slug: slugField,
    target: targetField,
    label: labelField.default(""),
    utm: utmField.default({ source: "", medium: "", campaign: "" }),
    showOrder: showOrderField.default(null),
  }),
  async run(ctx, input): Promise<{ id: string; slug: string; path: string }> {
    refuseOutsideTarget(ctx, input.target);
    const id = newId("lnk");
    const made = await ctx.db
      .insert(links)
      .values({
        id,
        slug: input.slug,
        target: input.target,
        label: input.label,
        utm: utmRecord(input.utm),
        showOrder: input.showOrder,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .onConflictDoNothing({ target: links.slug })
      .returning({ id: links.id });
    if (made.length === 0) {
      throw new OpError(
        "conflict",
        `/go/${input.slug} is already a link. Pick another short address, or change that one.`,
        { slug: `/go/${input.slug} is already a link` },
      );
    }
    const entity = { type: "link", id };
    await ctx.audit({
      entity,
      summary: `Made the short link /go/${input.slug}, going to ${input.target}`,
      data: { slug: input.slug, target: input.target },
    });
    await ctx.emit({
      type: "link.created",
      entity,
      payload: { linkId: id, slug: input.slug, target: input.target },
    });
    return { id, slug: input.slug, path: `/go/${input.slug}` };
  },
});

export const updateLink = defineOp({
  name: "links.update",
  title: "Change a short link",
  description:
    "Changes where a short link goes, its label, its utm labels or its place on the public links page. Leave a field out to keep it; pass `showOrder: null` to take it off the public page. The short address itself cannot be changed, because it may already be printed or posted somewhere: make a new link instead. The new target has to pass the same check as a new link's, and only an owner may point a link at another website.",
  access: "write",
  input: z.object({
    id: recordId,
    target: targetField.optional(),
    label: labelField.optional(),
    utm: utmField.optional(),
    showOrder: showOrderField.optional(),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    const link = await loadLink(ctx.db, input.id);
    if (input.target !== undefined && input.target !== link.target) {
      refuseOutsideTarget(ctx, input.target);
    }
    const next = {
      target: input.target ?? link.target,
      label: input.label ?? link.label,
      utm: input.utm === undefined ? link.utm : utmRecord(input.utm),
      showOrder:
        input.showOrder === undefined ? link.showOrder : input.showOrder,
    };
    await ctx.db
      .update(links)
      .set({ ...next, updatedAt: ctx.now })
      .where(eq(links.id, link.id));
    await ctx.audit({
      entity: { type: "link", id: link.id },
      summary:
        next.target === link.target
          ? `Changed the short link /go/${link.slug}`
          : `Pointed the short link /go/${link.slug} at ${next.target}`,
      data: { before: { target: link.target, showOrder: link.showOrder } },
    });
    return { id: link.id };
  },
});

export const setLinkActive = defineOp({
  name: "links.setActive",
  title: "Switch a short link on or off",
  description:
    "Switches a short link off, so following it lands on the front page of the shop and is not counted, or back on. Nothing is deleted and the count is kept.",
  access: "write",
  input: z.object({ id: recordId, active: z.boolean() }),
  async run(ctx, input): Promise<{ active: boolean }> {
    const link = await loadLink(ctx.db, input.id);
    if (link.active === input.active) return { active: link.active };
    await ctx.db
      .update(links)
      .set({ active: input.active, updatedAt: ctx.now })
      .where(eq(links.id, link.id));
    await ctx.audit({
      entity: { type: "link", id: link.id },
      summary: `Switched the short link /go/${link.slug} ${input.active ? "on" : "off"}`,
    });
    return { active: input.active };
  },
});

/* ---- following ---------------------------------------------------------- */

export type ResolvedLink =
  | {
      readonly found: true;
      readonly slug: string;
      /** path: stay on this site. https: go to this full address. */
      readonly kind: "path" | "https";
      /** Where to send the visitor, utm labels added. */
      readonly url: string;
    }
  | { readonly found: false };

export const resolveLink = defineOp({
  name: "links.resolve",
  title: "Follow a short link",
  description:
    "Given a slug, says where to send the visitor (the saved target with the link's utm labels added) and, unless `count` is false, adds one to the link's click count in the same single statement. An unknown slug, a link that is switched off, or a saved target that is not a page on this site or an https address comes back as not found. Nothing about the visitor is stored. It is listed as a read so that a click does not put a line in the activity log, but with `count` left on every call adds a click: to look at a link without counting, pass `count: false` or use links.list. The public /go/<slug> address calls it with `count: false`, sends the redirect, and counts afterwards with links.countClick.",
  access: "read",
  input: z.object({
    // Whatever was in the address bar. Anything that is not a slug is simply
    // not found, so the public route never has an error to show.
    slug: z.string().transform((value) => value.trim().toLowerCase()),
    count: z.boolean().default(true),
  }),
  async run(ctx, input): Promise<ResolvedLink> {
    if (!SLUG_PATTERN.test(input.slug)) return { found: false };
    const live = and(eq(links.slug, input.slug), eq(links.active, true));
    const [link] = input.count
      ? await ctx.db
          .update(links)
          .set({ clicks: sql`${links.clicks} + 1` })
          .where(live)
          .returning({ target: links.target, utm: links.utm })
      : await ctx.db
          .select({ target: links.target, utm: links.utm })
          .from(links)
          .where(live);
    if (link === undefined) return { found: false };

    // Checked again here, whatever was checked when it was saved.
    const saved = safeLinkTarget(link.target);
    if (saved === null) return { found: false };
    const target = withUtm(saved, link.utm);
    if (target === null) return { found: false };
    return {
      found: true,
      slug: input.slug,
      kind: target.kind,
      url: target.value,
    };
  },
});

export const countLinkClick = defineOp({
  name: "links.countClick",
  title: "Count a click on a short link",
  description:
    "Adds one to a short link's click count: one guarded statement that only counts a link that exists and is switched on. The public /go/<slug> address calls this after it has sent the redirect, and only for a visit that looks like a person (not a HEAD request, a link preview, a search engine or a page fetched ahead of time). Nothing about the visitor is stored. It is listed as a read so that clicks do not fill the activity log; it is not something to call by hand.",
  access: "read",
  input: z.object({
    slug: z.string().transform((value) => value.trim().toLowerCase()),
  }),
  async run(ctx, input): Promise<{ counted: boolean }> {
    if (!SLUG_PATTERN.test(input.slug)) return { counted: false };
    const counted = await ctx.db
      .update(links)
      .set({ clicks: sql`${links.clicks} + 1` })
      .where(and(eq(links.slug, input.slug), eq(links.active, true)))
      .returning({ id: links.id });
    return { counted: counted.length > 0 };
  },
});

export type PublicLink = {
  readonly slug: string;
  readonly label: string;
  /** The address to link to, so the click is counted: "/go/insta". */
  readonly href: string;
};

/**
 * For the public links page, when it is built: the links marked to be shown
 * there, in their order. Only links that are switched on and still point
 * somewhere allowed.
 */
export async function listPublicLinks(db: DbOrTx): Promise<PublicLink[]> {
  const rows = await db
    .select({
      slug: links.slug,
      label: links.label,
      target: links.target,
    })
    .from(links)
    .where(and(eq(links.active, true), isNotNull(links.showOrder)))
    .orderBy(asc(links.showOrder), asc(links.createdAt));
  return rows
    .filter((row) => safeLinkTarget(row.target) !== null)
    .map((row) => ({
      slug: row.slug,
      label: row.label === "" ? row.slug : row.label,
      href: `/go/${row.slug}`,
    }));
}
