import { describe, expect, it } from "vitest";

import {
  fetchReceived,
  fetchReceivedRaw,
  rawDownloadUrl,
  receivedFor,
  ResendFetchError,
} from "@/lib/mail/resend";

/**
 * Fetching an email Resend took in for us, with a fake network. The webhook
 * that says one has arrived only describes it: the original is fetched
 * afterwards, with the key, from Resend, and then downloaded, without the
 * key, from wherever Resend says it is.
 */

const KEY = "re_TestKey_0123456789abcdef";

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
    for (const id of [
      "",
      "../domains",
      "a/b",
      "id with spaces",
      "x".repeat(81),
    ]) {
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
      [
        json(200, { raw: { download_url: DOWNLOAD } }),
        new Response("", { status: 403 }),
      ],
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
    expect(
      receivedFor({ received_for: " hello@quickpickle.example " }),
    ).toEqual(["hello@quickpickle.example"]);
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
