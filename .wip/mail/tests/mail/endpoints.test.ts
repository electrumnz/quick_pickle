import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as inboundRoute } from "@/app/api/mail/inbound/route";
import { POST as resendRoute } from "@/app/api/mail/resend/route";
import {
  auditLog,
  events,
  mailboxes,
  mailConversations,
  mailMessages,
  mailSuppressions,
  users,
} from "@/db/schema";
import type { Caller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import {
  handleInboundRaw,
  handleResendWebhook,
} from "@/lib/backstage/mail/endpoints";
import { deliverQueuedMail, sendReply } from "@/lib/backstage/mail/ops";
import {
  closeDb,
  openEmbedded,
  useDbHandle,
  type DbHandle,
} from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import { clearSentForTests } from "@/lib/mail";

/**
 * The two doors mail comes in by. What matters most here is who is let in:
 * every refusal is checked for having stored nothing.
 */

const NOW = new Date("2026-11-12T00:00:00Z");
const INBOUND_SECRET = "an-inbound-secret-long-enough";
const WEBHOOK_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const API_KEY = "re_TestKey_0123456789abcdef";
const DOWNLOAD = "https://inbound.example-cdn.com/raw/abc?signature=xyz";

const fixture = (name: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures/mail", name)));

let handle: DbHandle;
let staff: Caller;

const count = async () => (await handle.db.select().from(mailMessages)).length;

const body = async (response: Response) =>
  (await response.json()) as Record<string, unknown>;

beforeAll(async () => {
  handle = await openEmbedded();
  useDbHandle(handle);
  const id = newId("usr");
  await handle.db
    .insert(users)
    .values({ id, email: "staff@example.co.nz", name: "staff", role: "staff" });
  staff = {
    actor: { type: "human", userId: id, name: "staff", role: "staff" },
    via: "ui",
    confirmed: true,
  };
  await handle.db.insert(mailboxes).values([
    {
      id: newId("mbx"),
      address: "hello@quickpickle.example",
      displayName: "Quick Pickle",
      isDefault: true,
    },
    {
      id: newId("mbx"),
      address: "orders@quickpickle.example",
      displayName: "Quick Pickle orders",
    },
  ]);
});

afterAll(async () => {
  await closeDb();
});

describe("POST /api/mail/inbound", () => {
  const env = { MAIL_INBOUND_SECRET: INBOUND_SECRET };
  const post = (
    raw: Uint8Array<ArrayBuffer> | string,
    headers: Record<string, string> = {},
    environment: Record<string, string | undefined> = env,
  ) =>
    handleInboundRaw(
      new Request("https://quickpickle.example/api/mail/inbound", {
        method: "POST",
        headers: { "content-type": "message/rfc822", ...headers },
        body: raw,
      }),
      { env: environment, db: handle.db, now: NOW },
    );
  const bearer = { authorization: `Bearer ${INBOUND_SECRET}` };

  it("is shut, not open, when no secret is set", async () => {
    for (const environment of [
      {},
      { MAIL_INBOUND_SECRET: "" },
      { MAIL_INBOUND_SECRET: "   " },
      // Too short to be a secret is the same as not having one.
      { MAIL_INBOUND_SECRET: "hunter2" },
    ]) {
      for (const headers of [
        {},
        bearer,
        { authorization: "Bearer " },
        { authorization: "Bearer hunter2" },
        { authorization: "Bearer undefined" },
      ]) {
        const response = await post(
          fixture("where-is-my-order.eml"),
          headers,
          environment,
        );
        expect(response.status).toBe(503);
        expect(await body(response)).toEqual({
          ok: false,
          error: "not_configured",
        });
      }
    }
    expect(await count()).toBe(0);
  });

  it("refuses a caller without the secret, and stores nothing", async () => {
    for (const headers of [
      {},
      { authorization: "" },
      { authorization: "Bearer" },
      { authorization: "Bearer wrong-secret-wrong-secret-wrong" },
      { authorization: `Bearer ${INBOUND_SECRET}x` },
      { authorization: `Bearer ${INBOUND_SECRET.slice(0, -1)}` },
      { authorization: `Basic ${INBOUND_SECRET}` },
      { authorization: INBOUND_SECRET },
      { "x-api-key": INBOUND_SECRET },
      { cookie: `qp_staff=${INBOUND_SECRET}` },
    ]) {
      const response = await post(fixture("where-is-my-order.eml"), headers);
      expect(response.status, JSON.stringify(headers)).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
      expect(response.headers.get("cache-control")).toBe("no-store");
      // The answer never says what the secret is or how close the guess was.
      expect(JSON.stringify(await body(response))).toBe(
        '{"ok":false,"error":"unauthorised"}',
      );
    }
    expect(await count()).toBe(0);
  });

  it("takes in a raw email from a caller with the secret", async () => {
    const response = await post(fixture("where-is-my-order.eml"), bearer);
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true, result: "stored" });
    expect(response.headers.get("set-cookie")).toBeNull();

    const [message] = await handle.db.select().from(mailMessages);
    expect(message).toMatchObject({
      messageId: "<liam-0001@mail.example.co.nz>",
      fromAddress: "liam.carter@example.co.nz",
      direction: "in",
    });
    const [line] = await handle.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.operation, "mail.ingest"));
    expect(line).toMatchObject({ actorName: "Inbox", via: "webhook" });
  });

  it("answers a second delivery of the same email with success and changes nothing", async () => {
    const before = await count();
    const response = await post(fixture("where-is-my-order.eml"), bearer);
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true, result: "duplicate" });
    expect(await count()).toBe(before);
  });

  it("uses the envelope address a forwarder passes along", async () => {
    const raw = new TextEncoder().encode(
      "From: Bcc Sender <bcc@example.com>\r\nSubject: Blind copy\r\nMessage-ID: <bcc-9@example.com>\r\n\r\nHello.\r\n",
    );
    const response = await post(raw, {
      ...bearer,
      "x-envelope-to": "Orders@QuickPickle.example",
    });
    expect(response.status).toBe(200);
    const [message] = await handle.db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.messageId, "<bcc-9@example.com>"));
    const [thread] = await handle.db
      .select()
      .from(mailConversations)
      .where(eq(mailConversations.id, message?.conversationId ?? ""));
    const [box] = await handle.db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.id, thread?.mailboxId ?? ""));
    expect(box?.address).toBe("orders@quickpickle.example");
  });

  it("refuses an empty body and one over 25 MB", async () => {
    const empty = await post("", bearer);
    expect(empty.status).toBe(400);

    // Honest about its size: refused from the header, before reading.
    const declared = await post("Subject: small\r\n\r\nx", {
      ...bearer,
      "content-length": String(25 * 1024 * 1024 + 1),
    });
    expect(declared.status).toBe(413);

    // Not honest: refused as soon as the bytes pass the limit.
    const before = await count();
    const big = new Uint8Array(25 * 1024 * 1024 + 1).fill(0x61);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < big.byteLength; at += 1024 * 1024) {
          controller.enqueue(big.subarray(at, at + 1024 * 1024));
        }
        controller.close();
      },
    });
    const streamed = await handleInboundRaw(
      new Request("https://quickpickle.example/api/mail/inbound", {
        method: "POST",
        headers: bearer,
        body: stream,
        duplex: "half",
      } as RequestInit),
      { env, db: handle.db, now: NOW },
    );
    expect(streamed.status).toBe(413);
    expect(await count()).toBe(before);
  });

  it("the route itself is wired to the same door", async () => {
    const saved = process.env.MAIL_INBOUND_SECRET;
    const request = (authorization?: string) =>
      new Request("https://quickpickle.example/api/mail/inbound", {
        method: "POST",
        headers: authorization === undefined ? {} : { authorization },
        body: fixture("where-is-my-order.eml"),
      });
    try {
      delete process.env.MAIL_INBOUND_SECRET;
      expect((await inboundRoute(request())).status).toBe(503);
      process.env.MAIL_INBOUND_SECRET = INBOUND_SECRET;
      expect((await inboundRoute(request())).status).toBe(401);
      expect((await inboundRoute(request("Bearer nope"))).status).toBe(401);
      const ok = await inboundRoute(request(`Bearer ${INBOUND_SECRET}`));
      expect(ok.status).toBe(200);
      expect(await body(ok)).toEqual({ ok: true, result: "duplicate" });
    } finally {
      if (saved === undefined) delete process.env.MAIL_INBOUND_SECRET;
      else process.env.MAIL_INBOUND_SECRET = saved;
    }
  });
});

describe("POST /api/mail/resend", () => {
  const env = {
    RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RESEND_API_KEY: API_KEY,
  };
  const seconds = String(Math.floor(NOW.getTime() / 1000));

  const sign = (
    payload: string,
    id = "msg_2b1f",
    timestamp = seconds,
    secret = WEBHOOK_SECRET,
  ) => {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64")}`;
  };

  type Call = { url: string; authorization: string | null };
  const network = (answers: readonly (Response | Error)[]) => {
    const calls: Call[] = [];
    const queue = [...answers];
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      const next = queue.shift();
      if (next === undefined) throw new Error("no answer scripted");
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch;
    return { fetch: fake, calls };
  };

  const send = (
    payload: unknown,
    options: {
      headers?: Record<string, string>;
      env?: Record<string, string | undefined>;
      fetch?: typeof fetch;
      raw?: string;
    } = {},
  ) => {
    const text = options.raw ?? JSON.stringify(payload);
    return handleResendWebhook(
      new Request("https://quickpickle.example/api/mail/resend", {
        method: "POST",
        headers: options.headers ?? {
          "svix-id": "msg_2b1f",
          "svix-timestamp": seconds,
          "svix-signature": sign(text),
        },
        body: text,
      }),
      {
        env: options.env ?? env,
        db: handle.db,
        now: NOW,
        fetch:
          options.fetch ??
          ((async () => {
            throw new Error("the network should not have been touched");
          }) as typeof fetch),
      },
    );
  };

  const received = (emailId: string) => ({
    type: "email.received",
    created_at: "2026-11-12T00:00:00.000Z",
    data: {
      email_id: emailId,
      from: "Liam Carter <liam.carter@example.co.nz>",
      to: ["orders@quickpickle.example"],
      subject: "Sorry, one more thing",
    },
  });
  const rawAnswers = (name: string) => [
    new Response(
      JSON.stringify({
        object: "email",
        raw: { download_url: DOWNLOAD, expires_at: "2026-11-12T01:00:00Z" },
      }),
      { status: 200 },
    ),
    new Response(fixture(name), { status: 200 }),
  ];
  const EMAIL_ID = "4ef9a417-02e9-4d39-ad75-9611e0fcc33c";

  it("is shut when the webhook secret is not set or is not one", async () => {
    for (const secret of [undefined, "", "whsec_", "hunter2"]) {
      const response = await send(received(EMAIL_ID), {
        env: { ...env, RESEND_WEBHOOK_SECRET: secret },
      });
      expect(response.status, String(secret)).toBe(503);
    }
  });

  it("checks the signature before it does anything, and a bad one gets nowhere", async () => {
    const before = await count();
    const payload = JSON.stringify(received(EMAIL_ID));
    const cases: Record<string, string>[] = [
      // No headers at all.
      {},
      // Signed with somebody else's secret.
      {
        "svix-id": "msg_2b1f",
        "svix-timestamp": seconds,
        "svix-signature": sign(
          payload,
          "msg_2b1f",
          seconds,
          "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        ),
      },
      // A real signature, for a different body.
      {
        "svix-id": "msg_2b1f",
        "svix-timestamp": seconds,
        "svix-signature": sign(JSON.stringify(received("someone-elses-id"))),
      },
      // A real signature, replayed six minutes later.
      {
        "svix-id": "msg_2b1f",
        "svix-timestamp": String(Number(seconds) - 360),
        "svix-signature": sign(
          payload,
          "msg_2b1f",
          String(Number(seconds) - 360),
        ),
      },
      // A real signature under a different message id.
      {
        "svix-id": "msg_other",
        "svix-timestamp": seconds,
        "svix-signature": sign(payload),
      },
      // The secret itself where the signature goes.
      {
        "svix-id": "msg_2b1f",
        "svix-timestamp": seconds,
        "svix-signature": `v1,${WEBHOOK_SECRET.slice(6)}`,
      },
    ];
    for (const headers of cases) {
      const { fetch, calls } = network(rawAnswers("reply-by-headers.eml"));
      const response = await send(null, { headers, raw: payload, fetch });
      expect(response.status, JSON.stringify(headers)).toBe(401);
      expect(await body(response)).toEqual({
        ok: false,
        error: "bad_signature",
      });
      // Nothing was fetched on the say-so of an unsigned request.
      expect(calls).toHaveLength(0);
    }
    // Not even valid JSON is looked at before the signature.
    const garbage = await send(null, {
      headers: {
        "svix-id": "msg_2b1f",
        "svix-timestamp": seconds,
        "svix-signature": "v1,AAAA",
      },
      raw: "{not json",
    });
    expect(garbage.status).toBe(401);
    expect(await count()).toBe(before);
  });

  it("accepts one good signature among several", async () => {
    const payload = JSON.stringify({ type: "email.opened", data: {} });
    const response = await send(null, {
      raw: payload,
      headers: {
        "svix-id": "msg_2b1f",
        "svix-timestamp": seconds,
        "svix-signature": `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${sign(payload)}`,
      },
    });
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true, result: "ignored" });
  });

  it("fetches a received email from Resend and takes it in", async () => {
    const { fetch, calls } = network(rawAnswers("reply-by-headers.eml"));
    const response = await send(received(EMAIL_ID), { fetch });
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true, result: "stored" });

    expect(calls).toEqual([
      {
        url: `https://api.resend.com/emails/receiving/${EMAIL_ID}`,
        authorization: `Bearer ${API_KEY}`,
      },
      // The signed download address gets no key.
      { url: DOWNLOAD, authorization: null },
    ]);
    const [message] = await handle.db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.providerId, EMAIL_ID));
    expect(message).toMatchObject({
      messageId: "<liam-0002@mail.example.co.nz>",
      threadedBy: "headers",
      direction: "in",
    });
  });

  it("answers a redelivery without fetching anything again", async () => {
    const before = await count();
    const response = await send(received(EMAIL_ID));
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true, result: "duplicate" });
    expect(await count()).toBe(before);
  });

  it("asks to be tried again when Resend cannot be reached or the key is missing", async () => {
    const before = await count();
    const other = "11111111-2222-3333-4444-555555555555";
    const down = await send(received(other), {
      fetch: network([new TypeError("fetch failed")]).fetch,
    });
    expect(down.status).toBe(502);
    const gone = await send(received(other), {
      fetch: network([new Response("{}", { status: 404 })]).fetch,
    });
    expect(gone.status).toBe(502);
    const noAddress = await send(received(other), {
      fetch: network([new Response('{"id":"x"}', { status: 200 })]).fetch,
    });
    expect(noAddress.status).toBe(502);

    const noKey = await send(received(other), {
      env: { RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET },
    });
    expect(noKey.status).toBe(503);
    expect(await count()).toBe(before);
  });

  it("answers 200 and does nothing for events it has no use for", async () => {
    const before = await count();
    for (const payload of [
      { type: "email.sent", data: { email_id: EMAIL_ID } },
      { type: "email.opened", data: { email_id: EMAIL_ID } },
      { type: "contact.created", data: { id: "x" } },
      { type: "email.received", data: {} },
      { type: "email.received", data: { email_id: "../../domains" } },
      { type: 42 },
      { no: "type" },
      [],
      "a string",
    ]) {
      const response = await send(payload);
      expect(response.status, JSON.stringify(payload)).toBe(200);
      expect(await body(response)).toEqual({ ok: true, result: "ignored" });
    }
    const notJson = await send(null, { raw: "{not json" });
    expect(notJson.status).toBe(400);
    expect(await count()).toBe(before);
  });

  describe("what became of something we sent", () => {
    let conversationId = "";
    let messageId = "";
    let providerId = "";

    const reply = async (to: string, text: string) => {
      const sent = await execute(
        sendReply,
        { conversationId, to, subject: "Re: Where is my order?", body: text },
        staff,
        { db: handle.db, now: NOW },
      );
      const delivery = await deliverQueuedMail(
        handle.db,
        sent.messageId,
        NOW,
        { env: {} },
      );
      if (delivery.status !== "sent") throw new Error("not sent");
      return { messageId: sent.messageId, providerId: delivery.providerId };
    };
    const message = async (id: string) =>
      (
        await handle.db
          .select()
          .from(mailMessages)
          .where(eq(mailMessages.id, id))
      )[0];
    const status = async () =>
      (
        await handle.db
          .select()
          .from(mailConversations)
          .where(eq(mailConversations.id, conversationId))
      )[0]?.status;

    beforeAll(async () => {
      clearSentForTests();
      const [inbound] = await handle.db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.messageId, "<liam-0001@mail.example.co.nz>"));
      conversationId = inbound?.conversationId ?? "";
      const sent = await reply(
        "liam.carter@example.co.nz",
        "It left us this morning.",
      );
      messageId = sent.messageId;
      providerId = sent.providerId;
    });

    it("notes a delivery once", async () => {
      expect(await status()).toBe("waiting");
      const payload = {
        type: "email.delivered",
        data: { email_id: providerId, to: ["liam.carter@example.co.nz"] },
      };
      expect(await body(await send(payload))).toEqual({
        ok: true,
        result: "delivered",
      });
      const noted = await message(messageId);
      expect(noted?.status).toBe("sent");
      expect(noted?.headers["qp:delivered"]).toBe(NOW.toISOString());
      // Told twice, it changes nothing the second time.
      const lines = async () =>
        (
          await handle.db
            .select()
            .from(auditLog)
            .where(eq(auditLog.operation, "mail.recordProviderEvent"))
        ).length;
      const before = await lines();
      expect(await body(await send(payload))).toEqual({
        ok: true,
        result: "unchanged",
      });
      expect(await lines()).toBe(before);
      expect(await status()).toBe("waiting");
    });

    it("an event about an email that is not ours changes nothing", async () => {
      const response = await send({
        type: "email.bounced",
        data: { email_id: "not-one-of-ours-0001", to: ["x@example.com"] },
      });
      expect(await body(response)).toEqual({ ok: true, result: "unknown" });
      // An inbound email's provider id is not an email we sent.
      const inbound = await send({
        type: "email.bounced",
        data: { email_id: EMAIL_ID, to: ["liam.carter@example.co.nz"] },
      });
      expect(await body(inbound)).toEqual({ ok: true, result: "unknown" });
      expect(await handle.db.select().from(mailSuppressions)).toHaveLength(0);
    });

    it("a hard bounce marks the email, stops us writing there again, and puts it in front of a person", async () => {
      const response = await send({
        type: "email.bounced",
        data: {
          email_id: providerId,
          // Only an address we wrote to can be struck off.
          to: ["liam.carter@example.co.nz", "someone.else@example.com"],
          bounce: {
            type: "Permanent",
            subType: "General",
            message: "The recipient's mail server\n permanently rejected the email.",
          },
        },
      });
      expect(await body(response)).toEqual({ ok: true, result: "bounced" });

      const bounced = await message(messageId);
      expect(bounced).toMatchObject({
        status: "bounced",
        error: "The recipient's mail server permanently rejected the email.",
      });
      expect(await status()).toBe("needs-reply");
      expect(await handle.db.select().from(mailSuppressions)).toMatchObject([
        { email: "liam.carter@example.co.nz", reason: "bounce" },
      ]);
      const [event] = await handle.db
        .select()
        .from(events)
        .where(eq(events.type, "mail.bounced"));
      expect(event?.payload).toMatchObject({
        conversationId,
        messageId,
        to: ["liam.carter@example.co.nz"],
        permanent: true,
        suppressed: ["liam.carter@example.co.nz"],
      });
      const [line] = await handle.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.operation, "mail.recordProviderEvent"))
        .orderBy(auditLog.at);
      expect(line?.via).toBe("webhook");

      // And now a reply to that address is refused.
      await expect(
        execute(
          sendReply,
          {
            conversationId,
            to: "liam.carter@example.co.nz",
            subject: "Re: Where is my order?",
            body: "Trying again.",
          },
          staff,
          { db: handle.db, now: NOW },
        ),
      ).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringContaining("do-not-email list"),
      });
    });

    it("a soft bounce marks the email and suppresses nobody", async () => {
      const soft = await reply("liam@carterfamily.example.com", "Second go.");
      const response = await send({
        type: "email.bounced",
        data: {
          email_id: soft.providerId,
          to: ["liam@carterfamily.example.com"],
          bounce: { type: "Transient", subType: "MailboxFull", message: "Full" },
        },
      });
      expect(await body(response)).toEqual({ ok: true, result: "bounced" });
      expect((await message(soft.messageId))?.status).toBe("bounced");
      expect(
        (await handle.db.select().from(mailSuppressions)).map((row) => row.email),
      ).toEqual(["liam.carter@example.co.nz"]);
    });

    it("a complaint stops us writing to them again", async () => {
      const third = await reply("club@touchlinefc.example.co.nz", "Third go.");
      const payload = {
        type: "email.complained",
        data: {
          email_id: third.providerId,
          to: ["club@touchlinefc.example.co.nz"],
        },
      };
      expect(await body(await send(payload))).toEqual({
        ok: true,
        result: "complained",
      });
      expect(await body(await send(payload))).toEqual({
        ok: true,
        result: "unchanged",
      });
      const rows = await handle.db
        .select()
        .from(mailSuppressions)
        .where(eq(mailSuppressions.email, "club@touchlinefc.example.co.nz"));
      expect(rows).toMatchObject([{ reason: "complaint" }]);
      // The email itself did arrive: it is not marked as failed.
      expect((await message(third.messageId))?.status).toBe("sent");
    });
  });

  it("the route itself is wired to the same door", async () => {
    const saved = process.env.RESEND_WEBHOOK_SECRET;
    const payload = JSON.stringify({ type: "email.opened", data: {} });
    const now = String(Math.floor(Date.now() / 1000));
    const request = (signature: string) =>
      new Request("https://quickpickle.example/api/mail/resend", {
        method: "POST",
        headers: {
          "svix-id": "msg_2b1f",
          "svix-timestamp": now,
          "svix-signature": signature,
        },
        body: payload,
      });
    try {
      delete process.env.RESEND_WEBHOOK_SECRET;
      expect((await resendRoute(request(sign(payload, "msg_2b1f", now)))).status).toBe(
        503,
      );
      process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
      expect((await resendRoute(request("v1,AAAA"))).status).toBe(401);
      const ok = await resendRoute(request(sign(payload, "msg_2b1f", now)));
      expect(ok.status).toBe(200);
    } finally {
      if (saved === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
      else process.env.RESEND_WEBHOOK_SECRET = saved;
    }
  });
});
