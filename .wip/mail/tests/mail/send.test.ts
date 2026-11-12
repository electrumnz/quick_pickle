import { beforeEach, describe, expect, it } from "vitest";

import {
  assertSendable,
  clearSentForTests,
  getMailProvider,
  heldBecause,
  mailConnection,
  MailSendError,
  newMessageId,
  sendMail,
  sentForTests,
  type OutgoingMail,
} from "@/lib/mail";
import {
  fetchReceived,
  fetchReceivedRaw,
  formatAddress,
  rawDownloadUrl,
  receivedFor,
  ResendFetchError,
  scrubSecrets,
} from "@/lib/mail/resend";

/** The seam mail is sent through, and Resend behind it with a fake network. */

const KEY = "re_TestKey_0123456789abcdef";

const mail = (over: Partial<OutgoingMail> = {}): OutgoingMail => ({
  from: { address: "hello@quickpickle.example", name: "Quick Pickle" },
  to: [{ address: "liam.carter@example.co.nz", name: "Liam Carter" }],
  subject: "Re: Where is my order?",
  text: "It left us this morning.",
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

beforeEach(() => {
  clearSentForTests();
});

describe("choosing a provider", () => {
  it("is the log provider when nothing is set, and says nothing leaves", () => {
    for (const env of [{}, { MAIL_PROVIDER: "" }, { MAIL_PROVIDER: " LOG " }]) {
      const provider = getMailProvider(env);
      expect(provider.name).toBe("log");
      expect(provider.delivers).toBe(false);
    }
    expect(mailConnection({})).toEqual({
      provider: "log",
      delivers: false,
      held: null,
      problem: null,
    });
  });

  it("throws at once for a name it does not know, naming it", () => {
    expect(() => getMailProvider({ MAIL_PROVIDER: "sendgird" })).toThrow(
      'MAIL_PROVIDER is "sendgird", which is not a mail provider. Valid: log, resend.',
    );
    // A screen asking how things are set up gets the reason, not a crash.
    expect(mailConnection({ MAIL_PROVIDER: "sendgird" })).toMatchObject({
      provider: "sendgird",
      delivers: false,
      problem: expect.stringContaining("not a mail provider"),
    });
  });

  it("will not pretend to be Resend without a key", () => {
    expect(() => getMailProvider({ MAIL_PROVIDER: "resend" })).toThrow(
      'MAIL_PROVIDER is "resend" but RESEND_API_KEY is not set.',
    );
    const provider = getMailProvider({
      MAIL_PROVIDER: "resend",
      RESEND_API_KEY: KEY,
      MAIL_SEND: "live",
    });
    expect(provider).toMatchObject({ name: "resend", delivers: true });
    // Saying how it is set up never says the key.
    expect(
      JSON.stringify(
        mailConnection({
          MAIL_PROVIDER: "resend",
          RESEND_API_KEY: KEY,
          MAIL_SEND: "live",
        }),
      ),
    ).not.toContain(KEY);
  });
});

describe("the switch: a provider is not enough to send", () => {
  const resend = { MAIL_PROVIDER: "resend", RESEND_API_KEY: KEY };

  it("with Resend chosen and the switch off, records and sends nothing", async () => {
    for (const env of [
      resend,
      { ...resend, MAIL_SEND: "" },
      { ...resend, MAIL_SEND: "yes" },
      { ...resend, MAIL_SEND: "true" },
    ]) {
      clearSentForTests();
      const network = fakeFetch([]);
      const provider = getMailProvider(env, network.fetch);
      expect(provider).toMatchObject({ name: "resend", delivers: false });
      const result = await sendMail(mail(), { env, fetch: network.fetch });
      expect(result).toMatchObject({ provider: "resend", delivered: false });
      expect(network.calls).toHaveLength(0);
      expect(sentForTests()).toHaveLength(1);
      expect(mailConnection(env)).toMatchObject({
        provider: "resend",
        delivers: false,
        held: expect.stringContaining("MAIL_SEND"),
        problem: null,
      });
    }
  });

  it('only "live" turns it on', () => {
    for (const value of ["live", " LIVE ", "Live"]) {
      expect(heldBecause({ MAIL_SEND: value }), value).toBeNull();
      expect(
        getMailProvider({ ...resend, MAIL_SEND: value }).delivers,
        value,
      ).toBe(true);
    }
  });

  it("a preview deployment never sends, whatever its settings say", async () => {
    const env = { ...resend, MAIL_SEND: "live", VERCEL_ENV: "preview" };
    const network = fakeFetch([]);
    expect(heldBecause(env)).toMatch(/preview/);
    expect(getMailProvider(env, network.fetch).delivers).toBe(false);
    const result = await sendMail(mail(), { env, fetch: network.fetch });
    expect(result.delivered).toBe(false);
    expect(network.calls).toHaveLength(0);
    expect(mailConnection(env)).toMatchObject({
      delivers: false,
      held: expect.stringContaining("preview"),
    });
    // Production with the same settings does send.
    expect(
      getMailProvider({ ...env, VERCEL_ENV: "production" }).delivers,
    ).toBe(true);
  });

  it("the set-up is still checked with the switch off", () => {
    expect(() => getMailProvider({ MAIL_PROVIDER: "resend" })).toThrow(
      "RESEND_API_KEY is not set",
    );
  });

  it("a caller that knows better can make it record, and nothing else changes", async () => {
    const env = { ...resend, MAIL_SEND: "live" };
    const network = fakeFetch([]);
    const result = await sendMail(mail(), {
      env,
      fetch: network.fetch,
      record: true,
    });
    expect(result).toMatchObject({ provider: "resend", delivered: false });
    expect(network.calls).toHaveLength(0);
    // The email is still checked before it is recorded.
    await expect(
      sendMail(mail({ subject: "two\nlines" }), { env, record: true }),
    ).rejects.toThrow("line break");
  });
});

describe("the log provider", () => {
  it("sends nothing, keeps what it was given, and returns an id", async () => {
    const result = await sendMail(mail(), { env: {} });
    expect(result.provider).toBe("log");
    expect(result.id).toMatch(/^log-[0-9a-f-]{36}$/);
    const kept = sentForTests();
    expect(kept).toHaveLength(1);
    expect(kept[0]?.mail.subject).toBe("Re: Where is my order?");
    expect(kept[0]?.result).toEqual(result);
    expect(result.delivered).toBe(false);
  });

  it("treats the same idempotency key as the same email", async () => {
    const one = await sendMail(mail(), { env: {} });
    const two = await sendMail(mail({ text: "Sent again by mistake." }), {
      env: {},
    });
    expect(two).toEqual(one);
    expect(sentForTests()).toHaveLength(1);
  });

  it("keeps the last 50", async () => {
    for (let i = 0; i < 55; i += 1) {
      await sendMail(mail({ idempotencyKey: `key-${String(i)}` }), { env: {} });
    }
    const kept = sentForTests();
    expect(kept).toHaveLength(50);
    expect(kept[0]?.mail.idempotencyKey).toBe("key-5");
    expect(kept[49]?.mail.idempotencyKey).toBe("key-54");
  });
});

describe("Resend", () => {
  const env = {
    MAIL_PROVIDER: "resend",
    RESEND_API_KEY: KEY,
    MAIL_SEND: "live",
  };

  it("posts the email the way Resend's API wants it", async () => {
    const { fetch, calls } = fakeFetch([json(200, { id: "re-email-0001" })]);
    const result = await sendMail(
      mail({
        cc: [{ address: "club@example.co.nz" }],
        replyTo: { address: "reply+abc@quickpickle.example" },
        html: "<p>It left us this morning.</p>",
        messageId: "<ours-1@quickpickle.example>",
        headers: {
          "In-Reply-To": "<liam-0001@mail.example.co.nz>",
          References: "<liam-0001@mail.example.co.nz>",
          "List-Unsubscribe": "<https://quickpickle.example/u/abc>",
        },
        attachments: [
          {
            filename: "note.txt",
            contentType: "text/plain",
            bytes: new TextEncoder().encode("kia ora"),
          },
        ],
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
      from: "Quick Pickle <hello@quickpickle.example>",
      to: ["liam.carter@example.co.nz"],
      cc: ["club@example.co.nz"],
      reply_to: "reply+abc@quickpickle.example",
      subject: "Re: Where is my order?",
      text: "It left us this morning.",
      html: "<p>It left us this morning.</p>",
      headers: {
        "In-Reply-To": "<liam-0001@mail.example.co.nz>",
        References: "<liam-0001@mail.example.co.nz>",
        "List-Unsubscribe": "<https://quickpickle.example/u/abc>",
        "Message-ID": "<ours-1@quickpickle.example>",
      },
      attachments: [
        {
          filename: "note.txt",
          content: "a2lhIG9yYQ==",
          content_type: "text/plain",
        },
      ],
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
      json(422, {
        statusCode: 422,
        name: "validation_error",
        // A provider that echoed the key back must not get it into our logs.
        message: `The domain is not verified. (key ${KEY})`,
      }),
    ]);
    const error = await sendMail(mail(), { env, fetch }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MailSendError);
    expect(error).toMatchObject({
      provider: "resend",
      status: 422,
      retryable: false,
    });
    const message = (error as MailSendError).message;
    expect(message).toBe(
      "Resend refused the email (422): The domain is not verified. (key [key removed])",
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

  it("says so when Resend cannot be reached at all", async () => {
    const { fetch } = fakeFetch([
      new TypeError(`fetch failed for Bearer ${KEY}`),
    ]);
    const error = await sendMail(mail(), { env, fetch }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ status: null, retryable: true });
    expect((error as Error).message).not.toContain(KEY);
  });

  it("will not call an answer with no id a success", async () => {
    const { fetch } = fakeFetch([json(200, { ok: true })]);
    await expect(sendMail(mail(), { env, fetch })).rejects.toBeInstanceOf(
      MailSendError,
    );
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
    for (const name of ["From", "to", "Subject", "Message-ID", "Reply-To", "BCC"]) {
      expect(() => assertSendable(mail({ headers: { [name]: "x" } }))).toThrow(
        /cannot be set as an extra header/,
      );
    }
  });

  it("an email with nobody to go to, a bad address or no key", () => {
    expect(() => assertSendable(mail({ to: [] }))).toThrow();
    expect(() => assertSendable(mail({ to: [{ address: "not-an-address" }] })))
      .toThrow();
    expect(() => assertSendable(mail({ to: [{ address: "a@nodot" }] })))
      .toThrow();
    expect(() => assertSendable(mail({ idempotencyKey: "" }))).toThrow();
    expect(() => assertSendable(mail())).not.toThrow();
  });

  it("and so nothing is sent", async () => {
    const { fetch, calls } = fakeFetch([]);
    await expect(
      sendMail(mail({ subject: "a\nb" }), {
        env: {
          MAIL_PROVIDER: "resend",
          RESEND_API_KEY: KEY,
          MAIL_SEND: "live",
        },
        fetch,
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("small things", () => {
  it("makes a Message-ID on the sender's domain", () => {
    const id = newMessageId("Hello@QuickPickle.example");
    expect(id).toMatch(/^<[0-9a-f-]{36}@quickpickle\.example>$/);
    expect(newMessageId("hello@quickpickle.example")).not.toBe(id);
    expect(() => newMessageId("no-domain")).toThrow();
  });

  it("writes a from address a mail server will accept", () => {
    expect(formatAddress({ address: "a@example.com" })).toBe("a@example.com");
    expect(formatAddress({ address: "a@example.com", name: "Quick Pickle" })).toBe(
      "Quick Pickle <a@example.com>",
    );
    expect(
      formatAddress({ address: "a@example.com", name: "Tāwhiri, Mere" }),
    ).toBe('"Tāwhiri, Mere" <a@example.com>');
    expect(
      formatAddress({ address: "a@example.com", name: 'Evil" <x@example.com>' }),
    ).toBe('"Evil x@example.com" <a@example.com>');
  });

  it("takes key-shaped things out of text", () => {
    expect(scrubSecrets(`bad key ${KEY} used`, KEY)).toBe(
      "bad key [key removed] used",
    );
    expect(scrubSecrets("re_AnotherKey_abcdefgh and whsec_c2VjcmV0c2VjcmV0")).toBe(
      "[key removed] and [key removed]",
    );
    expect(scrubSecrets("Authorization: Bearer abcdefgh12345678")).toBe(
      "Authorization: Bearer [key removed]",
    );
    expect(scrubSecrets("nothing to see")).toBe("nothing to see");
  });
});

describe("fetching an email Resend received for us", () => {
  const options = (fetch: typeof globalThis.fetch) => ({
    apiKey: KEY,
    fetch,
    maxBytes: 1000,
  });
  const ID = "4ef9a417-02e9-4d39-ad75-9611e0fcc33c";
  const DOWNLOAD = "https://inbound.example-cdn.com/raw/abc?signature=xyz";
  const eml = new TextEncoder().encode("Subject: hi\r\n\r\nbody");

  it("asks Resend for the record, then downloads the original with no key", async () => {
    const { fetch, calls } = fakeFetch([
      json(200, {
        object: "email",
        id: ID,
        raw: { download_url: DOWNLOAD, expires_at: "2026-11-12T01:00:00Z" },
      }),
      new Response(eml, { status: 200 }),
    ]);
    const raw = await fetchReceivedRaw(ID, options(fetch));
    expect(new TextDecoder().decode(raw)).toBe("Subject: hi\r\n\r\nbody");

    expect(calls.map((call) => call.url)).toEqual([
      `https://api.resend.com/emails/receiving/${ID}`,
      DOWNLOAD,
    ]);
    expect(header(calls[0], "authorization")).toBe(`Bearer ${KEY}`);
    // The key goes to Resend and nowhere else.
    expect(header(calls[1], "authorization")).toBeNull();
    expect(JSON.stringify(calls[1]?.init)).not.toContain(KEY);
  });

  it("finds the download address under the other names it might have", () => {
    expect(rawDownloadUrl({ raw: { download_url: DOWNLOAD } })).toBe(DOWNLOAD);
    expect(rawDownloadUrl({ raw: { url: DOWNLOAD } })).toBe(DOWNLOAD);
    expect(rawDownloadUrl({ raw_download_url: DOWNLOAD })).toBe(DOWNLOAD);
    expect(rawDownloadUrl({ raw_url: DOWNLOAD })).toBe(DOWNLOAD);
    expect(rawDownloadUrl({ raw: DOWNLOAD })).toBe(DOWNLOAD);
    expect(rawDownloadUrl({ data: { raw: { download_url: DOWNLOAD } } })).toBe(
      DOWNLOAD,
    );
    expect(rawDownloadUrl({ html: "<p>no raw here</p>" })).toBeNull();
    expect(rawDownloadUrl(null)).toBeNull();
    expect(rawDownloadUrl("a string")).toBeNull();
  });

  it("refuses a download address that is not https on a public host", () => {
    for (const url of [
      "http://inbound.example-cdn.com/raw/abc",
      "https://localhost/raw",
      "https://127.0.0.1/raw",
      "https://10.0.0.8/raw",
      "https://[::1]/raw",
      "https://metadata.internal/raw",
      "https://printer.local/raw",
      "https://intranet/raw",
      "https://user:pass@inbound.example-cdn.com/raw",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "",
    ]) {
      expect(rawDownloadUrl({ raw: { download_url: url } }), url).toBeNull();
    }
  });

  it("does not go looking with an id that is not an id", async () => {
    const { fetch, calls } = fakeFetch([]);
    for (const id of ["", "../domains", "a/b", "id with spaces", "x".repeat(81)]) {
      await expect(fetchReceivedRaw(id, options(fetch))).rejects.toBeInstanceOf(
        ResendFetchError,
      );
    }
    expect(calls).toHaveLength(0);
  });

  it("reports what went wrong without the key in it", async () => {
    const cases: (Response | Error)[][] = [
      [json(404, { message: "not found" })],
      [new TypeError(`network down, key was ${KEY}`)],
      [json(200, { id: ID })],
      [json(200, { raw: { download_url: DOWNLOAD } }), new Response("", { status: 403 })],
      [new Response("not json", { status: 200 })],
    ];
    for (const answers of cases) {
      const { fetch } = fakeFetch(answers);
      const error = await fetchReceivedRaw(ID, options(fetch)).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ResendFetchError);
      expect((error as Error).message).not.toContain(KEY);
    }
  });

  it("stops reading an original that is bigger than it will take", async () => {
    const big = new Uint8Array(5000);
    const { fetch } = fakeFetch([
      json(200, { raw: { download_url: DOWNLOAD } }),
      new Response(big, { status: 200 }),
    ]);
    await expect(fetchReceivedRaw(ID, options(fetch))).rejects.toThrow(
      /too big/,
    );
    // And when the server admits the size up front, without reading at all.
    const { fetch: honest } = fakeFetch([
      json(200, { raw: { download_url: DOWNLOAD } }),
      new Response("tiny", {
        status: 200,
        headers: { "content-length": "999999" },
      }),
    ]);
    await expect(fetchReceivedRaw(ID, options(honest))).rejects.toThrow(
      /too big/,
    );
  });
});

describe("where a received email was really delivered", () => {
  const ID = "4ef9a417-02e9-4d39-ad75-9611e0fcc33c";
  const DOWNLOAD = "https://inbound.example-cdn.com/raw/abc?signature=xyz";

  it("reads the addresses Resend took from the Received headers", () => {
    expect(
      receivedFor({ received_for: ["reply+abc@quickpickle.example"] }),
    ).toEqual(["reply+abc@quickpickle.example"]);
    expect(receivedFor({ received_for: " hello@quickpickle.example " })).toEqual(
      ["hello@quickpickle.example"],
    );
    expect(
      receivedFor({ data: { received_for: ["a@example.com", 7, null, ""] } }),
    ).toEqual(["a@example.com"]);
    for (const nothing of [{}, null, "x", { received_for: { a: 1 } }]) {
      expect(receivedFor(nothing)).toEqual([]);
    }
  });

  it("comes back with the original", async () => {
    const { fetch } = fakeFetch([
      json(200, {
        raw: { download_url: DOWNLOAD },
        received_for: ["reply+abc@quickpickle.example"],
      }),
      new Response("Subject: hi\r\n\r\nbody", { status: 200 }),
    ]);
    const received = await fetchReceived(ID, {
      apiKey: KEY,
      fetch,
      maxBytes: 1000,
    });
    expect(new TextDecoder().decode(received.raw)).toContain("Subject: hi");
    expect(received.receivedFor).toEqual(["reply+abc@quickpickle.example"]);
  });
});

describe("did it go", () => {
  const env = {
    MAIL_PROVIDER: "resend",
    RESEND_API_KEY: KEY,
    MAIL_SEND: "live",
  };

  it("a plain no means it did not, and anything else means we cannot tell", async () => {
    for (const [status, outcome] of [
      [400, "refused"],
      [401, "refused"],
      [403, "refused"],
      [422, "refused"],
      [429, "refused"],
      [408, "unknown"],
      [409, "unknown"],
      [500, "unknown"],
      [503, "unknown"],
    ] as const) {
      const { fetch } = fakeFetch([new Response("no", { status })]);
      await expect(
        sendMail(mail(), { env, fetch }),
        String(status),
      ).rejects.toMatchObject({ status, outcome });
    }
  });

  it("no answer at all, or an answer with no id, is unknown", async () => {
    const down = fakeFetch([new TypeError("fetch failed")]);
    await expect(
      sendMail(mail(), { env, fetch: down.fetch }),
    ).rejects.toMatchObject({ status: null, outcome: "unknown" });
    const vague = fakeFetch([json(200, {})]);
    await expect(
      sendMail(mail(), { env, fetch: vague.fetch }),
    ).rejects.toMatchObject({ outcome: "unknown", retryable: false });
  });

  it("passes on the Message-ID it went out with, when the answer has one", async () => {
    const { fetch } = fakeFetch([
      json(200, {
        id: "re-email-0002",
        message_id: "<0100018f-abc@email.example-ses.com>",
      }),
    ]);
    await expect(sendMail(mail(), { env, fetch })).resolves.toEqual({
      provider: "resend",
      id: "re-email-0002",
      delivered: true,
      messageId: "<0100018f-abc@email.example-ses.com>",
    });
  });
});
