import { readFileSync } from "node:fs";
import { join } from "node:path";

import { asc, eq } from "drizzle-orm";

import {
  auditLog,
  events,
  mailConversations,
  mailLinks,
  mailMessages,
  orders,
  users,
} from "@/db/schema";
import { systemCaller, type Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import {
  deliverQueuedMail,
  ingestRawEmail,
  saveMailbox,
  sendReply,
  type DeliveryResult,
  type IngestResult,
} from "@/lib/backstage/mail/ops";
import { recordOrder } from "@/lib/backstage/orders/ops";
import {
  openEmbedded,
  // Not a React hook, whatever its name says to the linter.
  useDbHandle as pointTheAppAt,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";

/**
 * What the inbox's test files share: a fresh database with two mailboxes
 * and four callers, and short ways to write an email, send it in, answer it
 * and see what happened.
 *
 * Nothing here can reach a mail provider. An email that has to be "sent"
 * for a test goes to `fakeResend`, which is a function in this file.
 */

/** The address the tests' emails are sent from. Read when one is written. */
export const FROM = "hello@quickpickle.example";

const KEY = "re_TestKey_0123456789abcdef";

/** A production deployment with a real database and Resend connected. */
export const LIVE: Record<string, string | undefined> = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  DATABASE_URL: "postgres://u:p@db.example.com:6543/postgres",
  MAIL_PROVIDER: "resend",
  RESEND_API_KEY: KEY,
  MAIL_FROM: FROM,
};

export type SentByFake = {
  readonly id: string;
  readonly idempotencyKey: string | null;
  readonly body: {
    readonly from: string;
    readonly to: readonly string[];
    readonly reply_to?: string;
    readonly subject: string;
    readonly text: string;
    readonly html?: string;
    readonly headers?: Readonly<Record<string, string>>;
  };
};

/**
 * A stand-in for Resend: it takes every email it is handed, gives each an
 * id, and remembers what it was sent. The same idempotency key twice is the
 * same email, as it is with the real one.
 */
export function fakeResend(): {
  readonly fetch: typeof fetch;
  readonly sent: SentByFake[];
} {
  const sent: SentByFake[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== "https://api.resend.com/emails") {
      throw new Error(`the fake Resend was asked for ${String(input)}`);
    }
    const idempotencyKey = new Headers(init?.headers).get("idempotency-key");
    const before = sent.find(
      (email) =>
        idempotencyKey !== null && email.idempotencyKey === idempotencyKey,
    );
    const email = before ?? {
      id: `re-fake-${String(sent.length + 1).padStart(4, "0")}`,
      idempotencyKey,
      body: JSON.parse(String(init?.body)) as SentByFake["body"],
    };
    if (before === undefined) sent.push(email);
    return new Response(JSON.stringify({ id: email.id }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: fake, sent };
}

export const BASE = new Date("2026-11-10T00:00:00Z");
export const MINUTE = 60_000;
export const DAY = 86_400_000;

/** A fixed moment, so many minutes after the start of the test's world. */
export const at = (minutes: number) =>
  new Date(BASE.getTime() + minutes * MINUTE);

export const fixture = (name: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(
    readFileSync(join(process.cwd(), "tests/fixtures/mail", name)),
  );

/** A small plain-text email, written out the way one travels. */
export function email(
  headers: Record<string, string>,
  body: string,
): Uint8Array<ArrayBuffer> {
  const head = Object.entries({
    "MIME-Version": "1.0",
    "Content-Type": "text/plain; charset=utf-8",
    ...headers,
  })
    .map(([name, value]) => `${name}: ${value}`)
    .join("\r\n");
  return new TextEncoder().encode(`${head}\r\n\r\n${body}\r\n`);
}

/** A mail system's report that something we sent did not arrive. */
export function bounceReport(fill: {
  readonly id: string;
  readonly recipient: string;
  /** "failed" or "delayed". */
  readonly action?: string;
  /** "5.1.1" is a dead address. "4.2.2" is a full one. */
  readonly status?: string;
  /** The Message-ID of ours it says came back. */
  readonly messageId?: string;
  /** The reply token in the returned headers. */
  readonly token?: string;
}): Uint8Array<ArrayBuffer> {
  const template = new TextDecoder().decode(fixture("bounce.template.eml"));
  return new TextEncoder().encode(
    template
      .replaceAll("{{BOUNCE_ID}}", fill.id)
      .replaceAll("{{RECIPIENT}}", fill.recipient)
      .replaceAll("{{ACTION}}", fill.action ?? "failed")
      .replaceAll("{{STATUS}}", fill.status ?? "5.1.1")
      .replaceAll(
        "{{MESSAGE_ID}}",
        fill.messageId ?? "<never-seen@elsewhere.example.com>",
      )
      .replaceAll("{{TOKEN}}", fill.token ?? "none"),
  );
}

export type Stored = Extract<IngestResult, { status: "stored" }>;

export function stored(result: IngestResult): Stored {
  if (result.status !== "stored") {
    throw new Error(`expected a stored email, got ${result.status}`);
  }
  return result;
}

export type Inbox = {
  readonly handle: DbHandle;
  readonly owner: Caller;
  readonly staff: Caller;
  readonly viewer: Caller;
  /** A bot account with a member of staff's rights and no standing yes. */
  readonly bot: Caller;
  /** Send an email in and insist it was stored. */
  receive(
    headers: Record<string, string>,
    body: string,
    when: Date,
  ): Promise<Stored>;
  /** Write a reply as a member of staff and queue it. Returns its id. */
  reply(
    conversationId: string,
    body: string,
    when: Date,
    over?: { readonly to?: string; readonly subject?: string },
  ): Promise<string>;
  /**
   * Hand a queued message to the mail provider: the fake Resend, on a
   * deployment that sends, unless `options` says otherwise.
   */
  deliver(
    messageId: string,
    when: Date,
    options?: Parameters<typeof deliverQueuedMail>[3],
  ): Promise<DeliveryResult>;
  /** Everything the fake Resend has been handed, oldest first. */
  readonly sent: SentByFake[];
  conversation(id: string): Promise<typeof mailConversations.$inferSelect>;
  message(id: string): Promise<typeof mailMessages.$inferSelect>;
  messagesIn(
    conversationId: string,
  ): Promise<(typeof mailMessages.$inferSelect)[]>;
  /** "order:ord_…:auto", sorted. */
  linksOf(conversationId: string): Promise<string[]>;
  /** The kinds of event written about a conversation, oldest first. */
  eventsFor(conversationId: string): Promise<string[]>;
  /** The activity lines written about a conversation, oldest first. */
  auditFor(conversationId: string): Promise<string[]>;
  placeOrder(
    number: string,
    first: string,
    last: string,
  ): Promise<{ orderId: string; customerId: string; email: string }>;
};

let serial = 0;

/** Open a fresh in-process database with the inbox ready to use. */
export async function openInbox(): Promise<Inbox> {
  // The address an email is written from is read when it is written.
  process.env.MAIL_FROM = FROM;
  // A door for incoming mail is open, so what is sent asks for its replies
  // at a reply address of its own. (Nothing in a test listens at it.)
  process.env.MAIL_INBOUND_SECRET = "an-inbound-secret-for-tests-only";
  const handle = await openEmbedded();
  pointTheAppAt(handle);
  const { db } = handle;
  const resend = fakeResend();

  const make = async (
    role: "owner" | "staff" | "viewer",
    kind: "person" | "bot" = "person",
  ): Promise<Caller> => {
    const id = newId("usr");
    const name = kind === "bot" ? "Helper bot" : role;
    await db.insert(users).values({
      id,
      email: `${kind === "bot" ? "bot" : role}@example.co.nz`,
      name,
      role,
      kind,
    });
    return {
      actor: {
        type: kind === "bot" ? "bot" : "human",
        userId: id,
        name,
        role,
      },
      via: kind === "bot" ? "mcp" : "ui",
      confirmed: kind !== "bot",
    };
  };
  const owner = await make("owner");
  const staff = await make("staff");
  const viewer = await make("viewer");
  const bot = await make("staff", "bot");

  await execute(
    saveMailbox,
    {
      address: "hello@quickpickle.example",
      displayName: "Quick Pickle",
      signature: "The Quick Pickle crew",
    },
    owner,
    { db, now: at(-900) },
  );
  await execute(
    saveMailbox,
    {
      address: "orders@quickpickle.example",
      displayName: "Quick Pickle orders",
    },
    owner,
    { db, now: at(-899) },
  );

  const inbox: Inbox = {
    handle,
    owner,
    staff,
    viewer,
    bot,
    async receive(headers, body, when) {
      serial += 1;
      return stored(
        await ingestRawEmail(
          db,
          email(
            {
              To: "hello@quickpickle.example",
              "Message-ID": `<auto-${String(serial)}@mail.example.com>`,
              ...headers,
            },
            body,
          ),
          {},
          when,
        ),
      );
    },
    async reply(conversationId, body, when, over = {}) {
      const [row] = await db
        .select()
        .from(mailConversations)
        .where(eq(mailConversations.id, conversationId));
      const [last] = (await inbox.messagesIn(conversationId)).filter(
        (message) => message.direction === "in",
      );
      const sent = await execute(
        sendReply,
        {
          conversationId,
          to: over.to ?? last?.fromAddress ?? "nobody@example.com",
          subject: over.subject ?? `Re: ${row?.subject ?? ""}`,
          body,
        },
        staff,
        { db, now: when },
      );
      return sent.messageId;
    },
    async deliver(messageId, when, options) {
      return deliverQueuedMail(
        db,
        messageId,
        when,
        options ?? { env: LIVE, fetch: resend.fetch },
      );
    },
    sent: resend.sent,
    async conversation(id) {
      const [row] = await db
        .select()
        .from(mailConversations)
        .where(eq(mailConversations.id, id));
      if (row === undefined) throw new Error(`no conversation ${id}`);
      return row;
    },
    async message(id) {
      const [row] = await db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.id, id));
      if (row === undefined) throw new Error(`no message ${id}`);
      return row;
    },
    async messagesIn(conversationId) {
      return db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.conversationId, conversationId))
        .orderBy(asc(mailMessages.at), asc(mailMessages.createdAt));
    },
    async linksOf(conversationId) {
      const rows = await db
        .select()
        .from(mailLinks)
        .where(eq(mailLinks.conversationId, conversationId));
      return rows
        .map((link) => `${link.entityType}:${link.entityId}:${link.source}`)
        .sort();
    },
    async eventsFor(conversationId) {
      const rows = await db
        .select({ type: events.type })
        .from(events)
        .where(eq(events.entityId, conversationId))
        .orderBy(asc(events.at), asc(events.id));
      return rows.map((row) => row.type);
    },
    async auditFor(conversationId) {
      const rows = await db
        .select({ summary: auditLog.summary })
        .from(auditLog)
        .where(eq(auditLog.entityId, conversationId))
        .orderBy(asc(auditLog.at), asc(auditLog.id));
      return rows.map((row) => row.summary);
    },
    async placeOrder(number, first, last) {
      const address = `${first}.${last}@example.co.nz`.toLowerCase();
      await execute(
        recordOrder,
        {
          number,
          placedAt: at(-600),
          mode: "preorder",
          customer: {
            email: address,
            phone: null,
            firstName: first,
            lastName: last,
          },
          delivery: {
            line1: "41 Touchline Street",
            line2: null,
            suburb: null,
            city: "Christchurch",
            region: "Canterbury",
            postcode: "8011",
            rural: false,
            notes: null,
          },
          lines: [
            {
              sku: "QP-SHOT-12",
              name: "The Starter",
              shots: 12,
              qty: 1,
              unitCents: 4800,
              lineCents: 4800,
            },
          ],
          subtotalCents: 4800,
          shippingCents: 700,
          totalCents: 5500,
          currency: "NZD",
          payment: {
            provider: "fake",
            status: "paid",
            reference: `R-${number}`,
          },
          joinCrew: false,
        },
        systemCaller("The shop", "storefront"),
        { db, now: at(-600) },
      );
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.number, number));
      if (order === undefined || order.customerId === null) {
        throw new Error("the order was not placed");
      }
      return {
        orderId: order.id,
        customerId: order.customerId,
        email: address,
      };
    },
  };
  return inbox;
}
