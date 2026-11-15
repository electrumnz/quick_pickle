/**
 * The Pickle Crew: people who asked for our emails.
 *
 * The law (Unsolicited Electronic Messages Act 2007) puts three duties on
 * anyone sending marketing email in New Zealand: have consent and be able to
 * prove it, say who is sending, and make leaving easy and honour it within
 * five working days. This file is the first and the third. Joining records
 * how and when, and the words the person agreed to. Leaving takes effect at
 * once, and the row is kept as "unsubscribed" so the address is never added
 * back by a later import or a careless hand.
 */

import { and, count, desc, eq, ilike, type SQL } from "drizzle-orm";
import { z } from "zod";

import { crewMembers } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";

import { newToken } from "../auth/tokens";
import { notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";

type CrewSource = "crew-form" | "checkout" | "manual" | "import";

/** The sentence beside each way of joining. Stored with every sign-up. */
export const CONSENT_TEXT: Readonly<Record<CrewSource, string>> = {
  "crew-form":
    "Join the Pickle Crew. First dibs on new batches and whatever Lucky gets up to next.",
  checkout: "Add me to the Pickle Crew for news on new batches",
  manual: "Asked a member of staff to be added to the Pickle Crew.",
  import: "Imported from an earlier list with recorded consent.",
};

/**
 * Add an address to the crew inside a transaction someone else owns.
 * Someone who has unsubscribed and signs up again themselves is welcomed
 * back; staff and imports can never re-add them.
 */
export async function joinCrewIn(
  db: DbOrTx,
  who: {
    readonly email: string;
    readonly source: CrewSource;
    readonly customerId?: string | null;
  },
  now: Date,
): Promise<"joined" | "already" | "rejoined" | "kept-out"> {
  const [existing] = await db
    .select()
    .from(crewMembers)
    .where(eq(crewMembers.email, who.email));

  if (existing === undefined) {
    await db.insert(crewMembers).values({
      id: newId("crw"),
      email: who.email,
      status: "subscribed",
      source: who.source,
      consentText: CONSENT_TEXT[who.source],
      consentAt: now,
      unsubscribeToken: newToken(24),
      customerId: who.customerId ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return "joined";
  }

  if (existing.status === "subscribed") {
    if (existing.customerId === null && who.customerId) {
      await db
        .update(crewMembers)
        .set({ customerId: who.customerId, updatedAt: now })
        .where(eq(crewMembers.id, existing.id));
    }
    return "already";
  }

  const byThemselves = who.source === "crew-form" || who.source === "checkout";
  // A bounced or complained-about address stays out whoever asks.
  if (!byThemselves || existing.status !== "unsubscribed") return "kept-out";

  await db
    .update(crewMembers)
    .set({
      status: "subscribed",
      source: who.source,
      consentText: CONSENT_TEXT[who.source],
      consentAt: now,
      unsubscribedAt: null,
      customerId: existing.customerId ?? who.customerId ?? null,
      updatedAt: now,
    })
    .where(eq(crewMembers.id, existing.id));
  return "rejoined";
}

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("That email doesn't look right");

export const joinCrew = defineOp({
  name: "crew.join",
  title: "Add someone to the Pickle Crew",
  description:
    "Adds an email address to the mailing list and records how it got there. `crew-form` and `checkout` are the person signing up themselves. Use `manual` only when someone has asked a member of staff directly. An address that unsubscribed, bounced or complained is not re-added by staff.",
  access: "write",
  input: z.object({
    email: emailSchema,
    source: z.enum(["crew-form", "checkout", "manual", "import"]),
  }),
  async run(ctx, input): Promise<{ result: string }> {
    const result = await joinCrewIn(ctx.db, input, ctx.now);
    const entity = { type: "crew", id: input.email };
    if (result === "joined" || result === "rejoined") {
      await ctx.audit({
        entity,
        summary:
          result === "joined"
            ? `${input.email} joined the Pickle Crew`
            : `${input.email} came back to the Pickle Crew`,
        data: { source: input.source },
      });
      await ctx.emit({
        type: "crew.joined",
        entity,
        payload: { email: input.email, source: input.source },
      });
    } else {
      await ctx.audit({
        entity,
        summary:
          result === "already"
            ? `${input.email} is already in the Pickle Crew`
            : `${input.email} was not added: they have left the list or their address is no good`,
      });
    }
    return { result };
  },
});

export const leaveCrew = defineOp({
  name: "crew.unsubscribe",
  title: "Take someone off the Pickle Crew",
  description:
    "Unsubscribes an address, by the token from an email's unsubscribe link or by the address itself. Takes effect at once: a campaign already on its way leaves them out. Emails about an order of theirs are not marketing and still go. The row is kept so the address is never emailed or re-added by mistake. Asking again for somebody already off the list changes nothing.",
  access: "write",
  // It cannot be undone from here: only the person can join again.
  effect: "destructive",
  input: z
    .object({
      token: z.string().min(10).max(200).optional(),
      email: emailSchema.optional(),
    })
    .refine((value) => value.token !== undefined || value.email !== undefined, {
      message: "Give the token from the link, or the email address",
    }),
  explain: (input) =>
    `This takes ${input.email ?? "the address that unsubscribe link belongs to"} off the Pickle Crew. They are sent no more marketing, and nobody but them can put them back on.`,
  async run(ctx, input): Promise<{ email: string }> {
    const [member] = await ctx.db
      .select()
      .from(crewMembers)
      .where(
        input.token !== undefined
          ? eq(crewMembers.unsubscribeToken, input.token)
          : eq(crewMembers.email, input.email ?? ""),
      );
    if (member === undefined) {
      throw input.email === undefined
        ? notFound("That address")
        : new OpError(
            "not_found",
            `${input.email} is not on the Pickle Crew list, so there is nothing to take them off. They are not sent campaigns.`,
          );
    }
    if (member.status === "subscribed") {
      await ctx.db
        .update(crewMembers)
        .set({
          status: "unsubscribed",
          unsubscribedAt: ctx.now,
          updatedAt: ctx.now,
        })
        .where(eq(crewMembers.id, member.id));
      await ctx.audit({
        entity: { type: "crew", id: member.email },
        summary: `${member.email} left the Pickle Crew`,
      });
      await ctx.emit({
        type: "crew.left",
        entity: { type: "crew", id: member.email },
        payload: { email: member.email },
      });
    } else {
      // Already off it: the link pressed twice, or a mail program's own
      // button and then ours. Nothing changed, so the log gets no line.
      ctx.nothingChanged();
    }
    return { email: member.email };
  },
});

/** What an unsubscribe link is made of. Anything else is not looked up. */
const TOKEN = /^[A-Za-z0-9_-]{10,200}$/;

export type CrewStanding = {
  readonly email: string;
  /** True while they are on the list and being emailed. */
  readonly subscribed: boolean;
};

export const crewStanding = defineOp({
  name: "crew.standing",
  title:
    "Whose unsubscribe link this is, and whether they are still on the list",
  description:
    "For the shop's own unsubscribe page: given the token from an email's unsubscribe link, says whose address it is and whether they are still on the Pickle Crew. Null for a token that is not one of ours. The token is what proves somebody was sent the email, so only the shop itself asks: not a person, not a bot.",
  access: "read",
  input: z.object({ token: z.string().max(200) }),
  async run(ctx, input): Promise<CrewStanding | null> {
    if (ctx.actor.type !== "system") {
      throw new OpError("forbidden", "Only the shop itself asks that.");
    }
    if (!TOKEN.test(input.token)) return null;
    const [member] = await ctx.db
      .select({ email: crewMembers.email, status: crewMembers.status })
      .from(crewMembers)
      .where(eq(crewMembers.unsubscribeToken, input.token));
    return member === undefined
      ? null
      : { email: member.email, subscribed: member.status === "subscribed" };
  },
});

export type CrewRow = {
  readonly id: string;
  readonly email: string;
  readonly status: "subscribed" | "unsubscribed" | "bounced" | "complained";
  readonly source: CrewSource;
  readonly consentAt: Date;
  readonly unsubscribedAt: Date | null;
  readonly customerId: string | null;
};

export const listCrew = defineOp({
  name: "crew.list",
  title: "List the Pickle Crew",
  description:
    "Everyone on the mailing list, newest first, with how and when they joined. `status` narrows to subscribed, unsubscribed, bounced or complained.",
  access: "read",
  input: z.object({
    status: z
      .enum(["subscribed", "unsubscribed", "bounced", "complained", "all"])
      .default("subscribed"),
    q: z.string().trim().max(80).optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  async run(ctx, input): Promise<CrewRow[]> {
    const where: SQL[] = [];
    if (input.status !== "all")
      where.push(eq(crewMembers.status, input.status));
    if (input.q !== undefined && input.q !== "") {
      where.push(
        ilike(
          crewMembers.email,
          `%${input.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`,
        ),
      );
    }
    return ctx.db
      .select({
        id: crewMembers.id,
        email: crewMembers.email,
        status: crewMembers.status,
        source: crewMembers.source,
        consentAt: crewMembers.consentAt,
        unsubscribedAt: crewMembers.unsubscribedAt,
        customerId: crewMembers.customerId,
      })
      .from(crewMembers)
      .where(where.length === 0 ? undefined : and(...where))
      .orderBy(desc(crewMembers.consentAt))
      .limit(input.limit);
  },
});

export const countCrew = defineOp({
  name: "crew.count",
  title: "Count the Pickle Crew",
  description:
    "How many people are on the mailing list, and how many have left.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<{ subscribed: number; left: number }> {
    const rows = await ctx.db
      .select({ status: crewMembers.status, n: count() })
      .from(crewMembers)
      .groupBy(crewMembers.status);
    let subscribed = 0;
    let left = 0;
    for (const row of rows) {
      if (row.status === "subscribed") subscribed += row.n;
      else left += row.n;
    }
    return { subscribed, left };
  },
});
