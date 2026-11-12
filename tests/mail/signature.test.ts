import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  bearerToken,
  safeEqual,
  SVIX_TOLERANCE_SECONDS,
  verifySvixSignature,
} from "@/lib/mail/signature";

/**
 * The example from Svix's own documentation ("Verifying webhooks manually").
 * It was not made with the code under test, so it checks the scheme itself:
 * the key is the base64 after `whsec_`, the signed text is
 * `${id}.${timestamp}.${body}`, the result is base64 HMAC-SHA256.
 */
const DOC = {
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: "1614265330",
  body: '{"test": 2432232314}',
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};
const DOC_NOW = new Date(1614265330 * 1000);
const bytes = (text: string) => new TextEncoder().encode(text);

/** Sign the way the brief describes, with nothing borrowed from lib/. */
function sign(secret: string, id: string, timestamp: string, body: string) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

const check = (over: Partial<Parameters<typeof verifySvixSignature>[0]> = {}) =>
  verifySvixSignature({
    secret: DOC.secret,
    id: DOC.id,
    timestamp: DOC.timestamp,
    signature: DOC.signature,
    body: bytes(DOC.body),
    now: DOC_NOW,
    ...over,
  });

describe("the Svix signature on a Resend webhook", () => {
  it("accepts the example from Svix's documentation", () => {
    expect(check()).toEqual({ ok: true });
    // And the independent signer above agrees with it.
    expect(sign(DOC.secret, DOC.id, DOC.timestamp, DOC.body)).toBe(
      DOC.signature,
    );
  });

  it("refuses the wrong secret", () => {
    expect(check({ secret: "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).toEqual(
      { ok: false, reason: "mismatch" },
    );
  });

  it("refuses a body, an id or a timestamp that was changed after signing", () => {
    expect(check({ body: bytes('{"test": 2432232315}') })).toEqual({
      ok: false,
      reason: "mismatch",
    });
    expect(check({ id: "msg_someone_elses" })).toEqual({
      ok: false,
      reason: "mismatch",
    });
    // A timestamp inside the window, but not the one that was signed.
    expect(check({ timestamp: "1614265331" })).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("refuses a timestamp more than five minutes off, either way", () => {
    const at = (seconds: number) =>
      check({ now: new Date(DOC_NOW.getTime() + seconds * 1000) });
    expect(SVIX_TOLERANCE_SECONDS).toBe(300);
    expect(at(300)).toEqual({ ok: true });
    expect(at(-300)).toEqual({ ok: true });
    expect(at(301)).toEqual({ ok: false, reason: "stale" });
    expect(at(-301)).toEqual({ ok: false, reason: "stale" });
    expect(at(86_400)).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts any one good signature among several in the header", () => {
    const wrong = "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    expect(check({ signature: `${wrong} ${DOC.signature}` })).toEqual({
      ok: true,
    });
    expect(check({ signature: `${DOC.signature} ${wrong}` })).toEqual({
      ok: true,
    });
    expect(check({ signature: `${wrong}  ${wrong}` })).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("only reads v1 signatures", () => {
    const value = DOC.signature.slice(3);
    for (const signature of [
      `v2,${value}`,
      `v1a,${value}`,
      value,
      `,${value}`,
      `v1${value}`,
      "v1,",
      "v1,not base64 at all",
    ]) {
      expect(check({ signature }), signature).toEqual({
        ok: false,
        reason: "mismatch",
      });
    }
  });

  it("refuses a request with a header missing or malformed", () => {
    for (const over of [
      { id: null },
      { id: "" },
      { id: "has spaces" },
      { timestamp: null },
      { timestamp: "yesterday" },
      { timestamp: "1614265330.5" },
      { signature: null },
      { signature: "   " },
    ]) {
      expect(check(over), JSON.stringify(over)).toEqual({
        ok: false,
        reason: "missing",
      });
    }
  });

  it("says so when our own secret is not a Svix secret", () => {
    for (const secret of ["", "whsec_", "whsec_short", "not base64 !!!"]) {
      expect(check({ secret }), secret).toEqual({
        ok: false,
        reason: "unconfigured",
      });
    }
  });

  it("signs the bytes that arrived, not a re-encoding of them", () => {
    const body = '{"name":"Mere Tāwhiri","note":"line\\nbreak"}';
    const timestamp = "1614265330";
    expect(
      check({
        body: bytes(body),
        signature: sign(DOC.secret, DOC.id, timestamp, body),
      }),
    ).toEqual({ ok: true });
  });
});

describe("comparing secrets", () => {
  it("is true only for the same string", () => {
    expect(safeEqual("correct horse battery", "correct horse battery")).toBe(
      true,
    );
    expect(safeEqual("correct horse battery", "correct horse batterz")).toBe(
      false,
    );
    // Different lengths are not an error and not a match.
    expect(safeEqual("short", "a much longer secret than that")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("reads a bearer token and nothing else", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("bearer   abc123  ")).toBe("abc123");
    expect(bearerToken("Basic abc123")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Bearer two words")).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});
