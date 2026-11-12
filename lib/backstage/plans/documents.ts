/**
 * Documents: the business plan, the marketing plan, how-to sheets, policies
 * and notes. Written in Markdown, and never lost: every save keeps a copy of
 * what was written, who by and why, and any old copy can be put back.
 *
 * A document's address (its slug) is fixed when it is made. Other documents
 * link to it by that address, and the starter drafts are matched by it, so
 * renaming changes the title and leaves the address alone.
 */

import { and, asc, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { documents, documentVersions, type DocumentKind } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { formatNzDateTime } from "@/lib/time";

import type { Actor } from "../core/actor";
import { notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import { DOCUMENT_KINDS, KIND_LABEL, STARTER_AUTHOR } from "./labels";
import { countOf, line, prose, recordId, sortOrder, userIdOf } from "./shared";

/** As long as a document may be. Far more than any plan needs. */
export const MAX_BODY = 200_000;

/** Addresses that would collide with a screen of the same name. */
const RESERVED_SLUGS: readonly string[] = ["new"];

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "An address needs at least two characters")
  .max(80, "Keep the address to 80 characters or fewer")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Addresses are lower-case words joined by hyphens, like how-to-pack-an-order",
  );
const titleSchema = line(120).min(1, "Give it a title");
const summarySchema = line(240);
const bodySchema = prose(MAX_BODY);
const noteSchema = line(200);
const kindSchema = z.enum(DOCUMENT_KINDS, { error: "Pick a kind" });

/** A title as an address: "How to pack an order" is "how-to-pack-an-order". */
export function slugify(title: string): string {
  const slug = title
    // Split a macron or an accent from its letter, then drop the mark, so
    // "Māori" files under "maori".
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return slug.length >= 2 ? slug : "document";
}

export type DocumentRow = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly kind: DocumentKind;
  readonly summary: string;
  readonly sort: number;
  readonly updatedAt: Date;
  /** True while nobody has changed the starter draft it began as. */
  readonly starterDraft: boolean;
};

export type DocumentVersionRow = {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly savedByName: string;
  readonly savedAt: Date;
  readonly characters: number;
  /** The version the document holds now. */
  readonly current: boolean;
};

export type DocumentDetail = DocumentRow & {
  readonly body: string;
  readonly createdAt: Date;
  /** How many versions are kept in all. */
  readonly versionCount: number;
  /** The newest of them, newest first. */
  readonly versions: readonly DocumentVersionRow[];
};

export type DocumentVersionDetail = {
  readonly id: string;
  readonly slug: string;
  readonly documentTitle: string;
  readonly title: string;
  readonly body: string;
  readonly note: string;
  readonly savedByName: string;
  readonly savedAt: Date;
  /** True when this is word for word what the document holds now. */
  readonly sameAsNow: boolean;
};

/*
 * These sub-queries name the outer row in full ("documents"."id"). Drizzle
 * leaves the table name off a column in a one-table query, and a bare "id"
 * in here would mean the version's own.
 */
const starterDraftSql = sql<boolean>`coalesce((
  select v.saved_by is null and v.saved_by_name = ${STARTER_AUTHOR}
  from document_versions v
  where v.document_id = "documents"."id"
  order by v.saved_at desc, v.id desc
  limit 1
), false)`;

const kindOrderSql = sql`case ${documents.kind}
  when 'plan' then 0 when 'how-to' then 1 when 'policy' then 2 else 3 end`;

const newestFirst = [
  desc(documentVersions.savedAt),
  desc(documentVersions.id),
] as const;

async function loadDocument(
  db: DbOrTx,
  slug: string,
  options: { readonly lock?: boolean } = {},
): Promise<typeof documents.$inferSelect> {
  const query = db.select().from(documents).where(eq(documents.slug, slug));
  // A save reads the document and then writes it. Holding the row for the
  // length of the change keeps two saves at once from crossing over.
  const [row] = options.lock === true ? await query.for("update") : await query;
  if (row === undefined) throw notFound(`The document "${slug}"`);
  return row;
}

async function latestVersionId(
  db: DbOrTx,
  documentId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: documentVersions.id })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(...newestFirst)
    .limit(1);
  return row?.id ?? null;
}

/**
 * The moment a new version is stamped with: now, or a millisecond after the
 * last change if the clock has not moved on (two saves in the same instant,
 * or two servers whose clocks disagree). Versions of one document are then
 * always in a definite order.
 */
function nextSaveTime(now: Date, lastChange: Date): Date {
  return now.getTime() > lastChange.getTime()
    ? now
    : new Date(lastChange.getTime() + 1);
}

/** Who a version is recorded as written by. */
type Author = { readonly userId: string | null; readonly name: string };

function authorOf(actor: Actor): Author {
  return { userId: userIdOf(actor), name: actor.name };
}

async function writeVersion(
  db: DbOrTx,
  version: {
    readonly documentId: string;
    readonly title: string;
    readonly body: string;
    readonly note: string;
    readonly author: Author;
    readonly at: Date;
  },
): Promise<string> {
  const id = newId("ver");
  await db.insert(documentVersions).values({
    id,
    documentId: version.documentId,
    title: version.title,
    body: version.body,
    note: version.note,
    savedBy: version.author.userId,
    savedByName: version.author.name,
    savedAt: version.at,
  });
  return id;
}

/**
 * Put a new document in, with its first version. Shared by "create" and by
 * the starter drafts, which arrive under their own name instead of the name
 * of whoever pressed the button.
 */
export async function insertDocument(
  db: DbOrTx,
  values: {
    readonly slug: string;
    readonly title: string;
    readonly kind: DocumentKind;
    readonly summary: string;
    readonly body: string;
    readonly sort: number;
    readonly note: string;
  },
  author: Author,
  now: Date,
): Promise<{ id: string; versionId: string }> {
  const id = newId("doc");
  await db.insert(documents).values({
    id,
    slug: values.slug,
    title: values.title,
    kind: values.kind,
    summary: values.summary,
    body: values.body,
    sort: values.sort,
    updatedBy: author.userId,
    createdAt: now,
    updatedAt: now,
  });
  const versionId = await writeVersion(db, {
    documentId: id,
    title: values.title,
    body: values.body,
    note: values.note,
    author,
    at: now,
  });
  return { id, versionId };
}

export const listDocuments = defineOp({
  name: "plans.listDocuments",
  title: "List documents",
  description:
    "The documents kept in Plans: plans, how-to sheets, policies and notes, in that order and then in each kind's own order. `kind` narrows to one kind. Gives titles and one-line summaries, not the text: use plans.getDocument for that.",
  access: "read",
  input: z.object({
    kind: kindSchema.optional(),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  async run(ctx, input): Promise<DocumentRow[]> {
    const where: SQL[] = [];
    if (input.kind !== undefined) where.push(eq(documents.kind, input.kind));
    return ctx.db
      .select({
        id: documents.id,
        slug: documents.slug,
        title: documents.title,
        kind: documents.kind,
        summary: documents.summary,
        sort: documents.sort,
        updatedAt: documents.updatedAt,
        starterDraft: starterDraftSql,
      })
      .from(documents)
      .where(where.length === 0 ? undefined : and(...where))
      .orderBy(kindOrderSql, asc(documents.sort), asc(documents.title))
      .limit(input.limit);
  },
});

export const getDocument = defineOp({
  name: "plans.getDocument",
  title: "Open one document",
  description:
    "One document by its address (the last part of its link, like how-to-pack-an-order): its title, its text in Markdown, and the list of saved versions, newest first, each with who saved it, when and their note. The versions' own text is not included: use plans.getDocumentVersion.",
  access: "read",
  input: z.object({
    slug: slugSchema,
    versions: z.number().int().min(1).max(500).default(100),
  }),
  async run(ctx, input): Promise<DocumentDetail> {
    const doc = await loadDocument(ctx.db, input.slug);
    const rows = await ctx.db
      .select({
        id: documentVersions.id,
        title: documentVersions.title,
        note: documentVersions.note,
        savedBy: documentVersions.savedBy,
        savedByName: documentVersions.savedByName,
        savedAt: documentVersions.savedAt,
        characters: sql<number>`length(${documentVersions.body})::int`,
      })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, doc.id))
      .orderBy(...newestFirst)
      .limit(input.versions);
    const [kept] = await ctx.db
      .select({ n: count() })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, doc.id));
    const newest = rows[0];
    return {
      id: doc.id,
      slug: doc.slug,
      title: doc.title,
      kind: doc.kind,
      summary: doc.summary,
      sort: doc.sort,
      body: doc.body,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      starterDraft:
        newest !== undefined &&
        newest.savedBy === null &&
        newest.savedByName === STARTER_AUTHOR,
      versionCount: kept?.n ?? rows.length,
      versions: rows.map(({ savedBy: _savedBy, ...row }, index) => ({
        ...row,
        current: index === 0,
      })),
    };
  },
});

export const getDocumentVersion = defineOp({
  name: "plans.getDocumentVersion",
  title: "Open an old version of a document",
  description:
    "The full text of one saved version of a document, to read it or compare it with what the document says now. Take the version's id from plans.getDocument.",
  access: "read",
  input: z.object({ slug: slugSchema, versionId: recordId }),
  async run(ctx, input): Promise<DocumentVersionDetail> {
    const doc = await loadDocument(ctx.db, input.slug);
    const [version] = await ctx.db
      .select()
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.id, input.versionId),
          eq(documentVersions.documentId, doc.id),
        ),
      );
    if (version === undefined) throw notFound("That version");
    return {
      id: version.id,
      slug: doc.slug,
      documentTitle: doc.title,
      title: version.title,
      body: version.body,
      note: version.note,
      savedByName: version.savedByName,
      savedAt: version.savedAt,
      sameAsNow: version.title === doc.title && version.body === doc.body,
    };
  },
});

export const createDocument = defineOp({
  name: "plans.createDocument",
  title: "Start a new document",
  description:
    "Makes a new document: a plan, a how-to sheet, a policy or a note. The address is made from the title unless `slug` is given, and cannot be changed afterwards. The text is Markdown; a single line break is kept as a line break, so do not wrap paragraphs by hand. Refused if the address is already taken.",
  access: "write",
  input: z.object({
    title: titleSchema,
    slug: slugSchema.optional(),
    kind: kindSchema.default("note"),
    summary: summarySchema.default(""),
    body: bodySchema.default(""),
    sort: sortOrder.default(100),
  }),
  async run(ctx, input): Promise<{ id: string; slug: string }> {
    const slug = input.slug ?? slugify(input.title);
    if (RESERVED_SLUGS.includes(slug)) {
      throw new OpError(
        "invalid_input",
        `"${slug}" cannot be used as an address. Pick another title or address.`,
        { slug: "That address is taken by a screen" },
      );
    }
    const [taken] = await ctx.db
      .select({ title: documents.title })
      .from(documents)
      .where(eq(documents.slug, slug));
    if (taken !== undefined) {
      throw new OpError(
        "conflict",
        `There is already a document at "${slug}": ${taken.title}. Pick another title or address.`,
        { slug: "Already in use" },
      );
    }

    const made = await insertDocument(
      ctx.db,
      { ...input, slug, note: "First version" },
      authorOf(ctx.actor),
      ctx.now,
    );
    const entity = { type: "document", id: made.id };
    await ctx.audit({
      entity,
      summary: `Started the ${KIND_LABEL[input.kind].toLowerCase()} "${input.title}"`,
      data: { slug, kind: input.kind },
    });
    await ctx.emit({
      type: "document.saved",
      entity,
      payload: {
        slug,
        title: input.title,
        kind: input.kind,
        versionId: made.versionId,
        reason: "created",
      },
    });
    return { id: made.id, slug };
  },
});

export type SaveResult = {
  readonly slug: string;
  /** False when what was sent is what the document already said. */
  readonly changed: boolean;
  readonly versionId: string | null;
  /**
   * True when someone else saved between this writer opening the document
   * and saving it. Both versions are in the history.
   */
  readonly overlapped: boolean;
};

export const saveDocument = defineOp({
  name: "plans.saveDocument",
  title: "Save a document",
  description:
    "Replaces a document's text (and its title, if one is given) and keeps a copy of the new version in its history, with the saver's name and an optional note on what changed. Nothing is lost: any earlier version can be put back with plans.restoreDocument. The text is Markdown; a single line break is kept as a line break. Saving the same text again changes nothing. Pass `basedOn` (the id of the version you started from) to be told if someone else saved in the meantime.",
  access: "write",
  input: z.object({
    slug: slugSchema,
    body: bodySchema,
    title: titleSchema.optional(),
    note: noteSchema.default(""),
    basedOn: recordId.optional(),
  }),
  async run(ctx, input): Promise<SaveResult> {
    const doc = await loadDocument(ctx.db, input.slug, { lock: true });
    const title = input.title ?? doc.title;
    const latest = await latestVersionId(ctx.db, doc.id);
    const overlapped = input.basedOn !== undefined && input.basedOn !== latest;

    if (title === doc.title && input.body === doc.body) {
      return { slug: doc.slug, changed: false, versionId: latest, overlapped };
    }

    const at = nextSaveTime(ctx.now, doc.updatedAt);
    const author = authorOf(ctx.actor);
    const versionId = await writeVersion(ctx.db, {
      documentId: doc.id,
      title,
      body: input.body,
      note: input.note,
      author,
      at,
    });
    await ctx.db
      .update(documents)
      .set({ title, body: input.body, updatedBy: author.userId, updatedAt: at })
      .where(eq(documents.id, doc.id));

    const entity = { type: "document", id: doc.id };
    await ctx.audit({
      entity,
      summary: `Saved "${title}"${input.note === "" ? "" : `: ${input.note}`}`,
      data: {
        slug: doc.slug,
        versionId,
        charactersBefore: doc.body.length,
        charactersAfter: input.body.length,
        overlapped,
      },
    });
    await ctx.emit({
      type: "document.saved",
      entity,
      payload: {
        slug: doc.slug,
        title,
        kind: doc.kind,
        versionId,
        reason: "saved",
      },
    });
    return { slug: doc.slug, changed: true, versionId, overlapped };
  },
});

export const restoreDocument = defineOp({
  name: "plans.restoreDocument",
  title: "Put back an old version of a document",
  description:
    "Makes a document say what one of its saved versions said: title and text. This is itself a new save, so the version being replaced stays in the history and the step can be reversed the same way. Does nothing if the document already matches that version.",
  access: "write",
  input: z.object({ slug: slugSchema, versionId: recordId }),
  async run(ctx, input): Promise<SaveResult> {
    const doc = await loadDocument(ctx.db, input.slug, { lock: true });
    const [version] = await ctx.db
      .select()
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.id, input.versionId),
          eq(documentVersions.documentId, doc.id),
        ),
      );
    if (version === undefined) throw notFound("That version");
    if (version.title === doc.title && version.body === doc.body) {
      return {
        slug: doc.slug,
        changed: false,
        versionId: await latestVersionId(ctx.db, doc.id),
        overlapped: false,
      };
    }

    const when = formatNzDateTime(version.savedAt);
    const at = nextSaveTime(ctx.now, doc.updatedAt);
    const author = authorOf(ctx.actor);
    const versionId = await writeVersion(ctx.db, {
      documentId: doc.id,
      title: version.title,
      body: version.body,
      note: `Put back the version from ${when}`,
      author,
      at,
    });
    await ctx.db
      .update(documents)
      .set({
        title: version.title,
        body: version.body,
        updatedBy: author.userId,
        updatedAt: at,
      })
      .where(eq(documents.id, doc.id));

    const entity = { type: "document", id: doc.id };
    await ctx.audit({
      entity,
      summary: `Put "${version.title}" back to the version from ${when}`,
      data: { slug: doc.slug, versionId, restoredFrom: version.id },
    });
    await ctx.emit({
      type: "document.saved",
      entity,
      payload: {
        slug: doc.slug,
        title: version.title,
        kind: doc.kind,
        versionId,
        reason: "restored",
      },
    });
    return { slug: doc.slug, changed: true, versionId, overlapped: false };
  },
});

export const renameDocument = defineOp({
  name: "plans.renameDocument",
  title: "Rename a document",
  description:
    "Changes a document's title and nothing else. Its address stays the same, so links to it keep working. The old title stays in the history.",
  access: "write",
  input: z.object({ slug: slugSchema, title: titleSchema }),
  async run(ctx, input): Promise<SaveResult> {
    const doc = await loadDocument(ctx.db, input.slug, { lock: true });
    if (input.title === doc.title) {
      return {
        slug: doc.slug,
        changed: false,
        versionId: await latestVersionId(ctx.db, doc.id),
        overlapped: false,
      };
    }
    const at = nextSaveTime(ctx.now, doc.updatedAt);
    const author = authorOf(ctx.actor);
    const versionId = await writeVersion(ctx.db, {
      documentId: doc.id,
      title: input.title,
      body: doc.body,
      note: `Renamed from "${doc.title}"`.slice(0, 200),
      author,
      at,
    });
    await ctx.db
      .update(documents)
      .set({ title: input.title, updatedBy: author.userId, updatedAt: at })
      .where(eq(documents.id, doc.id));

    const entity = { type: "document", id: doc.id };
    await ctx.audit({
      entity,
      summary: `Renamed "${doc.title}" to "${input.title}"`,
      data: { slug: doc.slug, versionId },
    });
    await ctx.emit({
      type: "document.saved",
      entity,
      payload: {
        slug: doc.slug,
        title: input.title,
        kind: doc.kind,
        versionId,
        reason: "renamed",
      },
    });
    return { slug: doc.slug, changed: true, versionId, overlapped: false };
  },
});

export const updateDocument = defineOp({
  name: "plans.updateDocument",
  title: "Change how a document is filed",
  description:
    "Changes a document's kind (plan, how-to sheet, policy or note), its one-line summary, or its place in the list (`sort`, lower first). It does not touch the title or the text, so it adds nothing to the history. Give only what should change.",
  access: "write",
  input: z.object({
    slug: slugSchema,
    kind: kindSchema.optional(),
    summary: summarySchema.optional(),
    sort: sortOrder.optional(),
  }),
  async run(ctx, input): Promise<{ slug: string; changed: string[] }> {
    const doc = await loadDocument(ctx.db, input.slug, { lock: true });
    const next = {
      kind: input.kind ?? doc.kind,
      summary: input.summary ?? doc.summary,
      sort: input.sort ?? doc.sort,
    };
    const changed: string[] = [];
    if (next.kind !== doc.kind) changed.push("kind");
    if (next.summary !== doc.summary) changed.push("summary");
    if (next.sort !== doc.sort) changed.push("place in the list");
    if (changed.length === 0) return { slug: doc.slug, changed };

    await ctx.db
      .update(documents)
      .set({
        ...next,
        updatedBy: userIdOf(ctx.actor),
        updatedAt: nextSaveTime(ctx.now, doc.updatedAt),
      })
      .where(eq(documents.id, doc.id));
    await ctx.audit({
      entity: { type: "document", id: doc.id },
      summary: `Changed the ${changed.join(" and ")} of "${doc.title}"`,
      data: {
        slug: doc.slug,
        before: { kind: doc.kind, sort: doc.sort },
        next,
      },
    });
    return { slug: doc.slug, changed };
  },
});

export const deleteDocument = defineOp({
  name: "plans.deleteDocument",
  title: "Delete a document",
  description:
    "Removes a document and every saved version of it, for good. Owners only. There is no way to bring it back, except that a deleted starter draft can be loaded again in its original wording (plans.loadStarter with restoreDeleted). To take a document out of use without losing it, change it to a note and say so in its summary instead.",
  access: "admin",
  effect: "destructive",
  input: z.object({ slug: slugSchema }),
  explain: (input) =>
    `This deletes the document at "${input.slug}" and every saved version of it. It cannot be undone.`,
  async run(ctx, input): Promise<{ slug: string; versions: number }> {
    const doc = await loadDocument(ctx.db, input.slug, { lock: true });
    const [history] = await ctx.db
      .select({ n: count() })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, doc.id));
    const versions = history?.n ?? 0;
    // The versions go with it: they hang off the document.
    await ctx.db.delete(documents).where(eq(documents.id, doc.id));
    await ctx.audit({
      entity: { type: "document", id: doc.id },
      summary: `Deleted "${doc.title}" and its ${countOf(versions, "saved version")}`,
      data: { slug: doc.slug, kind: doc.kind, versions },
    });
    return { slug: doc.slug, versions };
  },
});
