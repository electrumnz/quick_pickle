/**
 * The morning email.
 *
 * One email a day to whoever runs the shop, saying how many things need
 * them, so the back end reaches out instead of waiting to be opened. It
 * ships switched off. Switched on, the clock writes it once each New
 * Zealand morning (lib/backstage/clock/tick.ts).
 *
 * Three things it holds to:
 *
 *   - It carries no record. How many things are waiting, how many orders,
 *     what yesterday came to, and a link. Never a name, an address or an
 *     order number: real records stay behind the sign-in, and an inbox is
 *     not behind it.
 *   - Once a day. The email's id is worked out from the day, and a table
 *     holds an id once, so two ticks at once write one email.
 *   - Only when it would really go. With email not connected, or with its
 *     own address on the do-not-email list (one bounce puts it there),
 *     nothing is written down: a "not sent" line every morning would be
 *     noise. The settings screen says which it is.
 */

import "server-only";

import { createHash } from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { MORNING_EMAIL as W } from "@/content/emails";
import { mailConversations, mailMessages, orders, settings } from "@/db/schema";
import { ID_ALPHABET } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";
import { mailConnection } from "@/lib/mail";
import { compose, type EmailDoc, type Line } from "@/lib/mail/compose";
import { formatNzdExact } from "@/lib/shop/money";
import { siteUrl } from "@/lib/site";
import { nzDateKey, nzParts } from "@/lib/time";

import { refuseUnsendable } from "../core/copy";
import { conflict } from "../core/errors";
import { defineOp, type OpContext } from "../core/op";
import { whyNotEmail, writeOutbound } from "../mail/outbound";
import { numbersToday } from "../numbers/ops";
import { needsNow } from "../today/ops";

/** The one row its settings are kept in. */
export const MORNING_KEY = "digest.morning";

/** The earliest it goes, by the clock in New Zealand, and the latest. */
export const MORNING_FROM_HOUR = 7;
export const MORNING_UNTIL_HOUR = 11;

const stored = z.object({
  on: z.boolean(),
  to: z.string().trim().toLowerCase().max(254).email().nullable(),
});

export type MorningSettings = z.infer<typeof stored>;

const OFF: MorningSettings = { on: false, to: null };

export async function readMorning(db: DbOrTx): Promise<MorningSettings> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, MORNING_KEY));
  const read = stored.safeParse(row?.value);
  return read.success ? read.data : OFF;
}

/** The id of a day's morning email: the same day, the same id. */
function idFor(key: string): string {
  const hash = createHash("sha256").update(`morning-email:${key}`).digest();
  let out = "";
  for (const byte of hash.subarray(0, 20)) {
    out += ID_ALPHABET[byte % ID_ALPHABET.length];
  }
  return `msg_${out}`;
}

type Figures = {
  readonly needs: number;
  readonly pressing: number;
  readonly toPack: number;
  readonly packed: number;
  readonly yesterdayOrders: number;
  readonly yesterdayCents: number;
};

/** What the email says, as numbers. Nothing here names anybody. */
async function figures(ctx: OpContext): Promise<Figures> {
  const needs = await needsNow(ctx);
  const waiting = await ctx.db
    .select({ status: orders.status, n: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(eq(orders.isTest, false), inArray(orders.status, ["paid", "packed"])),
    )
    .groupBy(orders.status);
  const count = (status: "paid" | "packed") =>
    waiting.find((row) => row.status === status)?.n ?? 0;
  const { yesterday } = await numbersToday.run(ctx, {});
  return {
    needs: needs.length,
    pressing: needs.filter((need) => need.urgent).length,
    toPack: count("paid"),
    packed: count("packed"),
    yesterdayOrders: yesterday.orders,
    yesterdayCents: yesterday.salesCents,
  };
}

function docFor(say: Figures): EmailDoc {
  const data = (text: string) => ({ data: text });
  const lines: Line[] = [
    say.needs > 0 && say.pressing > 0
      ? [`${W.needs(say.needs)} ${W.pressing(say.pressing, say.needs)}`]
      : [W.needs(say.needs)],
  ];
  if (say.toPack === 0 && say.packed === 0) lines.push([W.nothingWaiting]);
  if (say.toPack > 0) lines.push([W.toPack(say.toPack)]);
  if (say.packed > 0) lines.push([W.packed(say.packed)]);
  lines.push(
    say.yesterdayOrders === 0
      ? [W.yesterday(0)]
      : [
          `${W.yesterday(say.yesterdayOrders)} `,
          data(formatNzdExact(say.yesterdayCents)),
          ".",
        ],
  );
  return {
    subject: [W.subject(say.needs)],
    blocks: [
      { kind: "text", lines: [[W.hello]] },
      { kind: "text", lines },
      { kind: "link", label: [W.open], href: `${siteUrl()}/backstage` },
      { kind: "text", lines: [[W.why]] },
    ],
  };
}

export type MorningStanding = MorningSettings & {
  /** True when an email written now would really be sent. */
  readonly canSend: boolean;
  /** Why not, in a sentence, when it would not. */
  readonly whyNot: string | null;
  /** The last New Zealand day one was written for: "2026-11-12". */
  readonly lastDay: string | null;
  /** What it would say if it were written this minute. */
  readonly preview: { readonly subject: string; readonly text: string };
};

async function lastDay(db: DbOrTx): Promise<string | null> {
  const [row] = await db
    .select({ headers: mailMessages.headers })
    .from(mailMessages)
    .where(sql`${mailMessages.headers}->>'qp:morning' is not null`)
    .orderBy(desc(mailMessages.createdAt))
    .limit(1);
  return row?.headers["qp:morning"]?.slice(0, 10) ?? null;
}

export const morningEmail = defineOp({
  name: "morning.get",
  title: "The morning email: whether it is on, and what it would say",
  description:
    "The morning email is one email a day to whoever runs the shop, saying how many things need them. This says whether it is switched on (`on`), where it goes (`to`), whether an email written now would really be sent (`canSend`, and `whyNot` in a sentence when not), the last day one was written (`lastDay`), and exactly what it would say this minute (`preview`). It carries counts and a link to the back end, and never a customer's name, address or order number.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<MorningStanding> {
    const now = await readMorning(ctx.db);
    const mail = mailConnection();
    // Its own address can end up on the do-not-email list like any other.
    const blocked =
      now.to === null ? null : await whyNotEmail(ctx.db, [now.to]);
    const email = compose(docFor(await figures(ctx)));
    return {
      ...now,
      canSend: mail.delivers && blocked === null,
      whyNot: mail.delivers ? blocked : (mail.problem ?? mail.held),
      lastDay: await lastDay(ctx.db),
      preview: { subject: email.subject, text: email.text },
    };
  },
});

export const setMorningEmail = defineOp({
  name: "morning.set",
  title: "Switch the morning email on or off, or change where it goes",
  description:
    "Switches the morning email on or off (`on`) and says which address it goes to (`to`). Switched on, one email is written each New Zealand morning, around seven, with how many things need a person, how many orders are waiting and what yesterday came to. It needs an address to be switched on. It carries no customer's details.",
  access: "write",
  input: z.object({
    on: z.boolean(),
    to: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .email("That does not look like an email address")
      .nullable()
      .optional(),
  }),
  async run(ctx, input): Promise<MorningSettings> {
    const before = await readMorning(ctx.db);
    const to = input.to === undefined ? before.to : input.to;
    if (input.on && to === null) {
      throw conflict("Say which address it goes to first.");
    }
    const after: MorningSettings = { on: input.on, to };
    if (before.on === after.on && before.to === after.to) {
      ctx.nothingChanged();
      return before;
    }
    await ctx.db
      .insert(settings)
      .values({
        key: MORNING_KEY,
        value: after,
        updatedAt: ctx.now,
        updatedBy: ctx.actor.type === "system" ? null : ctx.actor.userId,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: after,
          updatedAt: ctx.now,
          updatedBy: ctx.actor.type === "system" ? null : ctx.actor.userId,
        },
      });
    await ctx.audit({
      summary: after.on
        ? before.on
          ? `Changed where the morning email goes, to ${after.to ?? ""}`
          : `Switched the morning email on, to ${after.to ?? ""}`
        : "Switched the morning email off",
    });
    return after;
  },
});

export type MorningSent =
  | { readonly written: true; readonly messageId: string; readonly day: string }
  | { readonly written: false; readonly why: string };

export const sendMorningEmail = defineOp({
  name: "morning.send",
  title: "Write the morning email",
  description:
    "Writes the morning email and puts it in the queue to be sent: how many things need a person, how many orders are waiting to be packed or sent, what yesterday came to, and a link to the back end. Never a customer's name, address or order number. The clock runs this once each New Zealand morning while the morning email is switched on, and it writes one a day however often it is asked. `now: true` writes one this minute as well, to see it arrive. With email not connected nothing is written. Needs a yes from a person.",
  access: "write",
  effect: "outward",
  input: z.object({ now: z.boolean().default(false) }),
  explain: () => "This sends the morning email to the address it is set to.",
  async run(ctx, input): Promise<MorningSent> {
    const set = await readMorning(ctx.db);
    const no = (why: string): MorningSent => {
      ctx.nothingChanged();
      return { written: false, why };
    };
    if (set.to === null) return no("No address is set for it.");
    if (!input.now && !set.on) return no("The morning email is switched off.");
    const mail = mailConnection();
    if (!mail.delivers) {
      return no(mail.problem ?? mail.held ?? "Email is not connected.");
    }
    const blocked = await whyNotEmail(ctx.db, [set.to]);
    if (blocked !== null) return no(blocked);

    const day = nzDateKey(ctx.now);
    // The day's own email has the day for its id. One asked for by hand has
    // the moment as well, so it can be sent beside it.
    const key = input.now ? `${day}:${ctx.now.toISOString()}` : day;
    const id = idFor(key);
    const [before] = await ctx.db
      .select({ id: mailMessages.id })
      .from(mailMessages)
      .where(eq(mailMessages.id, id));
    if (before !== undefined) return no("Today's has already been written.");

    const email = compose(docFor(await figures(ctx)));
    refuseUnsendable({ subject: email.ours.subject, body: email.ours.body });

    // They are kept together: each joins the conversation the last one is
    // in, so the inbox holds one thread of them and not one a day.
    const [last] = await ctx.db
      .select({ conversationId: mailMessages.conversationId })
      .from(mailMessages)
      .where(sql`${mailMessages.headers}->>'qp:morning' is not null`)
      .orderBy(desc(mailMessages.createdAt))
      .limit(1);
    const [conversation] =
      last === undefined
        ? []
        : await ctx.db
            .select()
            .from(mailConversations)
            .where(eq(mailConversations.id, last.conversationId))
            .for("update");

    const written = await writeOutbound(ctx, {
      id,
      to: { address: set.to, name: "" },
      subject: email.subject,
      text: email.text,
      html: email.html,
      kind: "transactional",
      links: [],
      notes: { "qp:morning": key },
      ...(conversation === undefined ? {} : { conversation }),
    });
    if (written.status !== "queued") {
      // Only if the address was put on the do-not-email list in the instant
      // since it was looked at. It is written down, and says why.
      const why = written.notSent ?? "It was not sent.";
      await ctx.audit({
        summary: `Wrote the morning email for ${day} down and did not send it`,
        data: { messageId: written.messageId, why },
      });
      return { written: false, why };
    }
    await ctx.audit({
      summary: input.now
        ? `Wrote a morning email by hand, to go to ${set.to}`
        : `Wrote the morning email for ${day}, to go to ${set.to}`,
      data: { messageId: written.messageId },
    });
    return { written: true, messageId: written.messageId, day };
  },
});

export const MORNING_OPS = [
  morningEmail,
  setMorningEmail,
  sendMorningEmail,
] as const;

/**
 * For the clock: is it time for today's? Switched on, somewhere to send it,
 * morning in New Zealand, and none written for today yet.
 */
export async function morningEmailDue(db: DbOrTx, now: Date): Promise<boolean> {
  const set = await readMorning(db);
  if (!set.on || set.to === null) return false;
  const { hour } = nzParts(now);
  if (hour < MORNING_FROM_HOUR || hour >= MORNING_UNTIL_HOUR) return false;
  const [written] = await db
    .select({ id: mailMessages.id })
    .from(mailMessages)
    .where(eq(mailMessages.id, idFor(nzDateKey(now))));
  return written === undefined;
}
