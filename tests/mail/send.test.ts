import { describe, expect, it } from "vitest";

import {
  assertSendable,
  getMailProvider,
  heldBecause,
  mailConnection,
  mailFrom,
  MailSendError,
  messageIdFor,
  sendMail,
  type OutgoingMail,
} from "@/lib/mail";
import { formatAddress, scrubSecrets } from "@/lib/mail/resend";

/**
 * The seam mail is sent through, and Resend behind it with a fake network.
 * No test here, or anywhere, calls the real provider: the seam itself
 * refuses to put a call on the wire under a test runner.
 */

const KEY = "re_TestKey_0123456789abcdef";

/** A production deployment with a real database and everything set. */
const LIVE = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  DATABASE_URL: "postgres://u:p@db.example.com:6543/postgres",
  MAIL_PROVIDER: "resend",
  RESEND_API_KEY: KEY,
  MAIL_FROM: "orders@quickpickle.example",
};

const mail = (over: Partial<OutgoingMail> = {}): OutgoingMail => ({
  from: { address: "orders@quickpickle.example", name: "Quick Pickle" },
  to: [{ address: "liam.carter@example.co.nz", name: "Liam Carter" }],
  subject: "Your Quick Pickle order QP-7K2M9X",
  text: "Thanks for your order.",
  idempotencyKey: "msg_test0000000000000001",
  ...over,
});

type Call = { url: string; init: RequestInit };

/** A `fetch` that answers from a script and remembers what it was asked. */
function fakeFetch(
  answers: readonly (Response | Error | ((call: Call) => Response))[],
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...answers];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    const next = queue.shift();
    if (next === undefined) throw new Error("no answer scripted");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(call) : next;
  }) as typeof fetch;
  return { fetch: fake, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const header = (call: Call | undefined, name: string) =>
  new Headers(call?.init.headers).get(name);

describe("choosing a provider", () => {
  it("is off when nothing is set: nothing leaves, and it says so", async () => {
    for (const MAIL_PROVIDER of [undefined, "", " OFF "]) {
      const provider = getMailProvider({ ...LIVE, MAIL_PROVIDER });
      expect(provider.name).toBe("off");
      expect(provider.delivers).toBe(false);
    }
    // Handing it an email is not an error. The answer says nothing went.
    const { fetch, calls } = fakeFetch([]);
    expect(
      await sendMail(mail(), {
        env: { ...LIVE, MAIL_PROVIDER: undefined },
        fetch,
      }),
    ).toEqual({ provider: "off", id: "", delivered: false });
    expect(calls).toHaveLength(0);
  });

  it("says in a sentence why nothing is sent, and names what is still to set", () => {
    expect(
      mailConnection({
        NODE_ENV: "production",
        DATABASE_URL: LIVE.DATABASE_URL,
      }),
    ).toEqual({
      provider: "off",
      delivers: false,
      held: "No mail provider is connected, so emails are written down and not sent.",
      problem: null,
      missing: ["MAIL_PROVIDER", "RESEND_API_KEY", "MAIL_FROM"],
      from: null,
    });
  });

  it("throws at once for a name it does not know, naming it", () => {
    expect(() =>
      getMailProvider({ ...LIVE, MAIL_PROVIDER: "sendgird" }),
    ).toThrow(
      'MAIL_PROVIDER is "sendgird", which is not a mail provider. Valid: off, resend.',
    );
    // A screen asking how things are set up gets the reason, not a crash.
    expect(
      mailConnection({ ...LIVE, MAIL_PROVIDER: "sendgird" }),
    ).toMatchObject({
      provider: "sendgird",
      delivers: false,
      held: null,
      problem: expect.stringContaining("not a mail provider"),
      missing: ["MAIL_PROVIDER"],
    });
  });

  it("will not pretend to be Resend without a key or an address to send from", () => {
    expect(() =>
      getMailProvider({ ...LIVE, RESEND_API_KEY: undefined }),
    ).toThrow('MAIL_PROVIDER is "resend" but RESEND_API_KEY is not set.');
    expect(mailConnection({ ...LIVE, RESEND_API_KEY: " " })).toMatchObject({
      delivers: false,
      problem: 'MAIL_PROVIDER is "resend" but RESEND_API_KEY is not set.',
      missing: ["RESEND_API_KEY"],
    });
    expect(mailConnection({ ...LIVE, MAIL_FROM: undefined })).toMatchObject({
      delivers: false,
      problem:
        'MAIL_PROVIDER is "resend" but MAIL_FROM, the address to send from, is not set.',
      missing: ["MAIL_FROM"],
    });
    expect(
      mailConnection({ ...LIVE, MAIL_FROM: "Quick Pickle" }),
    ).toMatchObject({
      delivers: false,
      problem: "MAIL_FROM is not an email address.",
    });
  });

  it("with everything set, on production, it delivers and never says the key", () => {
    expect(getMailProvider(LIVE)).toMatchObject({
      name: "resend",
      delivers: true,
    });
    const connection = mailConnection(LIVE);
    expect(connection).toEqual({
      provider: "resend",
      delivers: true,
      held: null,
      problem: null,
      missing: [],
      from: "orders@quickpickle.example",
    });
    expect(JSON.stringify(connection)).not.toContain(KEY);
  });

  it("reads the address to send from, tidied, or nothing at all", () => {
    expect(mailFrom({ MAIL_FROM: " Orders@QuickPickle.example " })).toBe(
      "orders@quickpickle.example",
    );
    expect(mailFrom({})).toBeNull();
    expect(
      mailFrom({ MAIL_FROM: "Quick Pickle <orders@x.example>" }),
    ).toBeNull();
    expect(mailFrom({ MAIL_FROM: "orders@nodot" })).toBeNull();
  });
});

describe("where email may leave from: a provider is not enough", () => {
  it("only a production deployment with a real database", () => {
    expect(heldBecause(LIVE)).toBeNull();
    // No Vercel at all (another host): production is production.
    expect(heldBecause({ ...LIVE, VERCEL_ENV: undefined })).toBeNull();
  });

  it("never a back end running on invented records", async () => {
    const env = { ...LIVE, DATABASE_URL: undefined };
    expect(heldBecause(env)).toBe(
      "This back end is running on invented records, which never sends email.",
    );
    expect(mailConnection(env)).toMatchObject({
      provider: "resend",
      delivers: false,
      problem: null,
      held: "This back end is running on invented records, which never sends email.",
      missing: [],
    });
    const { fetch, calls } = fakeFetch([]);
    expect(await sendMail(mail(), { env, fetch })).toEqual({
      provider: "resend",
      id: "",
      delivered: false,
    });
    expect(calls).toHaveLength(0);
    // And with no provider chosen either, that is still the reason given.
    expect(mailConnection({ NODE_ENV: "production" }).held).toBe(
      "This back end is running on invented records, which never sends email.",
    );
  });

  it("never a preview deployment, whatever its settings say", async () => {
    // A preview is kept off the database unless it is told otherwise...
    expect(heldBecause({ ...LIVE, VERCEL_ENV: "preview" })).toBe(
      "This back end is running on invented records, which never sends email.",
    );
    // ...and does not send even then.
    const env = { ...LIVE, VERCEL_ENV: "preview", QP_PREVIEW_DATABASE: "1" };
    expect(heldBecause(env)).toBe(
      "This is a preview deployment, and a preview never sends email.",
    );
    const { fetch, calls } = fakeFetch([]);
    expect((await sendMail(mail(), { env, fetch })).delivered).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("never a development server, and never a test", async () => {
    expect(heldBecause({ ...LIVE, NODE_ENV: "development" })).toBe(
      "This is a development server, which never sends email.",
    );
    expect(heldBecause({ ...LIVE, NODE_ENV: "test" })).toBe(
      "Tests never send email.",
    );
    for (const NODE_ENV of ["development", "test", undefined]) {
      const { fetch, calls } = fakeFetch([]);
      const result = await sendMail(mail(), {
        env: { ...LIVE, NODE_ENV },
        fetch,
      });
      expect(result.delivered).toBe(false);
      expect(calls).toHaveLength(0);
    }
  });

  it("the set-up is still checked in a place that does not send", () => {
    expect(() =>
      getMailProvider({ NODE_ENV: "development", MAIL_PROVIDER: "resend" }),
    ).toThrow("RESEND_API_KEY is not set");
    expect(() =>
      getMailProvider({ NODE_ENV: "development", MAIL_PROVIDER: "smtp" }),
    ).toThrow("not a mail provider");
  });

  it("a test that reaches the real provider without its own fetch is refused, not sent", async () => {
    // This file runs under a test runner, so the seam will not use the
    // network even when everything else says it may.
    const error = await sendMail(mail(), { env: LIVE }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MailSendError);
    expect((error as Error).message).toContain(
      "A test has to hand in its own fetch",
    );
  });
});

describe("Resend", () => {
  const env = LIVE;

  it("posts the email the way Resend's API wants it", async () => {
    const { fetch, calls } = fakeFetch([json(200, { id: "re-email-0001" })]);
    const result = await sendMail(
      mail({
        cc: [{ address: "club@example.co.nz" }],
        replyTo: { address: "hello@quickpickle.example" },
        html: "<p>Thanks for your order.</p>",
        messageId: "<msg_test0000000000000001@quickpickle.example>",
        headers: {
          "In-Reply-To": "<liam-0001@mail.example.co.nz>",
          References: "<liam-0001@mail.example.co.nz>",
          "Auto-Submitted": "auto-generated",
        },
      }),
      { env, fetch },
    );
    expect(result).toEqual({
      provider: "resend",
      id: "re-email-0001",
      delivered: true,
    });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("https://api.resend.com/emails");
    expect(call?.init.method).toBe("POST");
    expect(header(call, "authorization")).toBe(`Bearer ${KEY}`);
    expect(header(call, "idempotency-key")).toBe("msg_test0000000000000001");
    expect(header(call, "content-type")).toBe("application/json");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      from: "Quick Pickle <orders@quickpickle.example>",
      to: ["liam.carter@example.co.nz"],
      cc: ["club@example.co.nz"],
      reply_to: "hello@quickpickle.example",
      subject: "Your Quick Pickle order QP-7K2M9X",
      text: "Thanks for your order.",
      html: "<p>Thanks for your order.</p>",
      headers: {
        "In-Reply-To": "<liam-0001@mail.example.co.nz>",
        References: "<liam-0001@mail.example.co.nz>",
        "Auto-Submitted": "auto-generated",
        "Message-ID": "<msg_test0000000000000001@quickpickle.example>",
      },
    });
  });

  it("leaves out what the email does not have", async () => {
    const { fetch, calls } = fakeFetch([json(200, { id: "re-email-0002" })]);
    await sendMail(mail(), { env, fetch });
    expect(Object.keys(JSON.parse(String(calls[0]?.init.body))).sort()).toEqual(
      ["from", "subject", "text", "to"],
    );
  });

  it("turns a refusal into an error with the status and Resend's words, never the key", async () => {
    const { fetch } = fakeFetch([
      json(403, {
        statusCode: 403,
        name: "validation_error",
        // A provider that echoed the key back must not get it into our logs.
        message: `The quickpickle.example domain is not verified. (key ${KEY})`,
      }),
    ]);
    const error = await sendMail(mail(), { env, fetch }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MailSendError);
    expect(error).toMatchObject({
      provider: "resend",
      status: 403,
      retryable: false,
      outcome: "refused",
    });
    const message = (error as MailSendError).message;
    expect(message).toBe(
      "Resend refused the email (403): The quickpickle.example domain is not verified. (key [key removed])",
    );
    expect(message).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(KEY);
  });

  it("marks what is worth trying again", async () => {
    for (const [status, retryable] of [
      [400, false],
      [401, false],
      [403, false],
      [409, true],
      [422, false],
      [429, true],
      [500, true],
      [503, true],
    ] as const) {
      const { fetch } = fakeFetch([
        new Response("upstream trouble", { status }),
      ]);
      await expect(sendMail(mail(), { env, fetch })).rejects.toMatchObject({
        status,
        retryable,
        message: `Resend refused the email (${String(status)}): upstream trouble`,
      });
    }
  });

  it("does not keep asking with a key that was used for a different email", async () => {
    const { fetch } = fakeFetch([
      json(409, {
        statusCode: 409,
        name: "invalid_idempotent_request",
        message: "Same idempotency key used with a different request payload.",
      }),
      json(409, {
        statusCode: 409,
        name: "concurrent_idempotent_requests",
        message:
          "Same idempotency key used while original request is still in progress.",
      }),
    ]);
    // An earlier request with this key was taken, so it may have gone.
    await expect(sendMail(mail(), { env, fetch })).rejects.toMatchObject({
      status: 409,
      retryable: false,
      outcome: "unknown",
    });
    // The first request is still in flight: wait and ask again.
    await expect(sendMail(mail(), { env, fetch })).rejects.toMatchObject({
      status: 409,
      retryable: true,
      outcome: "unknown",
    });
  });

  it("did it go: a plain no means it did not, and anything else means we cannot tell", async () => {
    for (const [status, outcome] of [
      [400, "refused"],
      [401, "refused"],
      [403, "refused"],
      [429, "refused"],
      [408, "unknown"],
      [500, "unknown"],
      [503, "unknown"],
    ] as const) {
      const { fetch } = fakeFetch([new Response("", { status })]);
      await expect(sendMail(mail(), { env, fetch })).rejects.toMatchObject({
        outcome,
      });
    }
  });

  it("says so when Resend cannot be reached at all", async () => {
    const { fetch } = fakeFetch([
      new TypeError(`fetch failed for Bearer ${KEY}`),
    ]);
    const error = await sendMail(mail(), { env, fetch }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({
      status: null,
      retryable: true,
      outcome: "unknown",
    });
    expect((error as Error).message).not.toContain(KEY);
  });

  it("will not call an answer with no id a success", async () => {
    const { fetch } = fakeFetch([json(200, { ok: true })]);
    await expect(sendMail(mail(), { env, fetch })).rejects.toMatchObject({
      retryable: false,
      outcome: "unknown",
    });
  });

  it("passes on the Message-ID it went out with, when the answer has one", async () => {
    const { fetch } = fakeFetch([
      json(200, { id: "re-email-0003", message_id: "<0102abc@email.example>" }),
    ]);
    expect(await sendMail(mail(), { env, fetch })).toEqual({
      provider: "resend",
      id: "re-email-0003",
      delivered: true,
      messageId: "<0102abc@email.example>",
    });
  });
});

describe("what is refused before any provider sees it", () => {
  it("anything that could smuggle a second header or a second email", () => {
    for (const bad of [
      mail({ subject: "Hello\r\nBcc: everyone@example.com" }),
      mail({ headers: { "X-Note": "fine\nBcc: everyone@example.com" } }),
      mail({ headers: { "X Note": "a space in the name" } }),
      mail({ headers: { "X-Note:": "a colon in the name" } }),
      mail({ from: { address: "hello@quickpickle.example", name: "A\nB" } }),
      mail({ to: [{ address: "liam@example.co.nz\r\nBcc: x@example.com" }] }),
      mail({ messageId: "<a@b>\r\nX: y" }),
    ]) {
      expect(() => assertSendable(bad)).toThrow();
    }
  });

  it("headers that are the email's own business", () => {
    for (const name of [
      "From",
      "to",
      "Subject",
      "Message-ID",
      "Reply-To",
      "BCC",
    ]) {
      expect(() => assertSendable(mail({ headers: { [name]: "x" } }))).toThrow(
        /cannot be set as an extra header/,
      );
    }
  });

  it("an email with nobody to go to, nobody to come from, no subject or no key", () => {
    expect(() => assertSendable(mail({ to: [] }))).toThrow();
    expect(() =>
      assertSendable(mail({ to: [{ address: "not-an-address" }] })),
    ).toThrow();
    expect(() =>
      assertSendable(mail({ to: [{ address: "a@nodot" }] })),
    ).toThrow();
    expect(() => assertSendable(mail({ from: { address: "" } }))).toThrow(
      "The from address is not an email address.",
    );
    expect(() => assertSendable(mail({ subject: "  " }))).toThrow();
    expect(() => assertSendable(mail({ idempotencyKey: "" }))).toThrow();
    expect(() => assertSendable(mail())).not.toThrow();
  });

  it("and so nothing is sent", async () => {
    const { fetch, calls } = fakeFetch([]);
    await expect(
      sendMail(mail({ subject: "a\nb" }), { env: LIVE, fetch }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("small things", () => {
  it("gives one of our emails the same Message-ID every time, on the sender's domain", () => {
    const id = messageIdFor(
      "msg_7k2m9x4q8b6t3n5h2w4c",
      "Hello@QuickPickle.example",
    );
    expect(id).toBe("<msg_7k2m9x4q8b6t3n5h2w4c@quickpickle.example>");
    expect(
      messageIdFor("msg_7k2m9x4q8b6t3n5h2w4c", "hello@quickpickle.example"),
    ).toBe(id);
    expect(messageIdFor("msg_7k2m9x4q8b6t3n5h2w4c", "no-domain")).toBeNull();
    expect(messageIdFor("has a space", "hello@quickpickle.example")).toBeNull();
  });

  it("writes a from address a mail server will accept", () => {
    expect(formatAddress({ address: "a@example.com" })).toBe("a@example.com");
    expect(
      formatAddress({ address: "a@example.com", name: "Quick Pickle" }),
    ).toBe("Quick Pickle <a@example.com>");
    expect(
      formatAddress({ address: "a@example.com", name: "Tāwhiri, Mere" }),
    ).toBe('"Tāwhiri, Mere" <a@example.com>');
    expect(
      formatAddress({
        address: "a@example.com",
        name: 'Evil" <x@example.com>',
      }),
    ).toBe('"Evil x@example.com" <a@example.com>');
  });

  it("takes key-shaped things out of text", () => {
    expect(scrubSecrets(`bad key ${KEY} used`, KEY)).toBe(
      "bad key [key removed] used",
    );
    expect(
      scrubSecrets("re_AnotherKey_abcdefgh and whsec_c2VjcmV0c2VjcmV0"),
    ).toBe("[key removed] and [key removed]");
    expect(scrubSecrets("Authorization: Bearer abcdefgh12345678")).toBe(
      "Authorization: Bearer [key removed]",
    );
    expect(scrubSecrets("nothing to see")).toBe("nothing to see");
  });
});
