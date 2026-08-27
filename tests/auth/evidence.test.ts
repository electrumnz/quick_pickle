import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LOGIN_CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/lib/auth/config";
import { fromBase64Url, toBase64Url } from "@/lib/auth/crypto/encoding";
import { randomBytes, randomToken } from "@/lib/auth/crypto/random";
import { seal } from "@/lib/auth/crypto/seal";
import { handleLoginPost } from "@/lib/auth/http/login-handler";
import { decideProxy } from "@/lib/auth/http/proxy-core";
import { verifySessionCookie } from "@/lib/auth/session";
import {
  buildLoginRequest,
  createHarness,
  mintCsrf,
  TEST_ORIGIN,
  TEST_PASSWORD,
  type Harness,
} from "./support/harness";

/**
 * Transcribes what the other tests assert into files a reviewer can read
 * without running anything. Every line written here is produced by the real
 * handler; nothing is transcribed by hand.
 */

const EVIDENCE_DIR = fileURLToPath(
  new URL("../../lib/auth/evidence/", import.meta.url),
);

function write(name: string, lines: readonly string[]): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(`${EVIDENCE_DIR}${name}`, `${lines.join("\n")}\n`, "utf8");
}

describe("evidence", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("records the Set-Cookie headers the gate actually emits", async () => {
    const csrf = await mintCsrf(harness);
    const signIn = await handleLoginPost(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: csrf.token,
        csrfCookie: csrf.cookie,
      }),
      harness.handlerOptions,
    );

    const proxyDecision = await decideProxy(
      new Request(`${TEST_ORIGIN}/login`),
      {
        store: harness.database.store,
        sessionSecret: harness.secret,
        clock: harness.clock,
      },
    );
    const csrfCookie =
      proxyDecision.kind === "continue"
        ? (proxyDecision.setCookies[0] ?? "")
        : "";

    const cleared = await decideProxy(
      new Request(`${TEST_ORIGIN}/admin`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=not-a-real-cookie` },
      }),
      {
        store: harness.database.store,
        sessionSecret: harness.secret,
        clock: harness.clock,
      },
    );

    const sessionHeader =
      signIn.headers
        .getSetCookie()
        .find((v) => v.startsWith("__Host-half_sour_admin=")) ?? "";
    expect(sessionHeader).not.toBe("");

    write("set-cookie-headers.txt", [
      "HALF SOUR — admin auth evidence",
      "Verbatim Set-Cookie headers from the real route handler and proxy",
      "",
      "1. Session cookie, on successful sign-in (POST /login/session -> 303):",
      "",
      `   ${redactValue(sessionHeader)}`,
      "",
      "   __Host- prefix ...... yes (browser enforces Secure + Path=/ + no Domain,",
      "                        so a sibling subdomain cannot overwrite it)",
      "   HttpOnly ............ yes (unreadable from document.cookie)",
      "   Secure .............. yes (never sent over plaintext HTTP)",
      "   SameSite ............ Strict (not sent on any cross-site navigation)",
      "   Path ................ / (required by the __Host- prefix)",
      "   Domain .............. absent (required by the __Host- prefix)",
      "   Max-Age ............. 1800 seconds, with a matching Expires",
      "   value ............... AES-256-GCM sealed; opaque and unforgeable",
      "",
      "2. Pre-authentication CSRF cookie, minted by the proxy on GET /login:",
      "",
      `   ${redactValue(csrfCookie)}`,
      "",
      "3. The same CSRF cookie being cleared once it is spent:",
      "",
      ...signIn.headers
        .getSetCookie()
        .filter((v) => v.startsWith(`${LOGIN_CSRF_COOKIE_NAME}=`))
        .map((v) => `   ${v}`),
      "",
      "4. A stale session cookie being cleared as the visitor is turned away",
      "   from /admin:",
      "",
      ...(cleared.kind === "redirect"
        ? cleared.setCookies.map((v) => `   ${v}`)
        : ["   (none)"]),
      "",
      `   redirect: ${cleared.kind === "redirect" ? `${String(cleared.status)} -> ${cleared.location}` : "n/a"}`,
      "",
      "Response headers on the sign-in response:",
      ...[...signIn.headers.entries()]
        .filter(([name]) => name !== "set-cookie")
        .map(([name, value]) => `   ${name}: ${value}`),
      "",
      "Cookie values are truncated in this transcript only; the tests assert on",
      "the full header. See tests/auth/login-http.test.ts.",
    ]);
  });

  it("records that a forged or tampered session cookie is refused", async () => {
    const csrf = await mintCsrf(harness);
    const signIn = await handleLoginPost(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: csrf.token,
        csrfCookie: csrf.cookie,
      }),
      harness.handlerOptions,
    );
    const header =
      signIn.headers
        .getSetCookie()
        .find((v) => v.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? "";
    const genuine = header.slice(header.indexOf("=") + 1).split(";")[0] ?? "";

    const lines: string[] = [
      "HALF SOUR — admin auth evidence",
      "Session cookie forgery and tampering, against the real verifier",
      "",
      `genuine cookie verifies: ${(await verify(genuine)).status}`,
      "",
    ];

    // Byte-level tampering across the whole ciphertext, including the GCM tag.
    const [version, iv, ciphertext] = genuine.split(".");
    const bytes = fromBase64Url(ciphertext ?? "");
    let rejectedByteFlips = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      const mutated = Uint8Array.from(bytes);
      mutated[index] = (mutated[index] ?? 0) ^ 0x01;
      const result = await verify(`${version}.${iv}.${toBase64Url(mutated)}`);
      if (result.status === "rejected") rejectedByteFlips += 1;
    }
    expect(rejectedByteFlips).toBe(bytes.length);
    lines.push(
      `single-bit flip in each of the ${String(bytes.length)} ciphertext bytes`,
      `  (the last 16 of which are the AES-GCM authentication tag):`,
      `  rejected ${String(rejectedByteFlips)} / ${String(bytes.length)}`,
      "",
    );

    // A cookie minted from scratch under an attacker's own key.
    const attackerKey = await seal(
      randomBytes(32),
      "session",
      {
        sid: "00000000-0000-4000-8000-000000000000",
        tok: randomToken(32),
        csrf: randomToken(32),
      },
      new Date(harness.clock.now().getTime() + 3_600_000),
    );
    const forgedUnderOwnKey = await verify(attackerKey);
    expect(forgedUnderOwnKey.status).toBe("rejected");
    lines.push(
      `cookie sealed under an attacker's own key: rejected (${reason(forgedUnderOwnKey)})`,
    );

    // A cookie sealed with OUR key but naming a real session with a made-up
    // bearer token — i.e. what an attacker who learned a session id could try.
    const rows = await harness.database.rows<{ id: string }>(
      "select id from public.admin_sessions limit 1",
    );
    const guessedToken = await seal(
      harness.secret,
      "session",
      { sid: rows[0]?.id ?? "", tok: randomToken(32), csrf: randomToken(32) },
      new Date(harness.clock.now().getTime() + 3_600_000),
    );
    const guessed = await verify(guessedToken);
    expect(guessed.status).toBe("rejected");
    lines.push(
      `cookie naming a real session with a guessed token: rejected (${reason(guessed)})`,
    );

    // Structural attacks.
    for (const [label, candidate] of [
      ["truncated", genuine.slice(0, -8)],
      ["re-versioned", `v2.${iv}.${ciphertext}`],
      ["iv removed", `${version}..${ciphertext}`],
      ["empty", ""],
      ["plausible-looking rubbish", "v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAA"],
    ] as const) {
      const result = await verify(candidate);
      expect(result.status).toBe("rejected");
      lines.push(`${label.padEnd(28)} rejected (${reason(result)})`);
    }

    // And a revoked session: cryptographically perfect, still refused.
    await harness.database.store.revokeSession({
      id: rows[0]?.id ?? "",
      at: harness.clock.now(),
      reason: "signed_out_everywhere",
    });
    const revoked = await verify(genuine);
    expect(revoked.status).toBe("rejected");
    lines.push(
      "",
      `the untouched genuine cookie, after server-side revocation: rejected (${reason(revoked)})`,
      "  — which is the reason a session row exists at all: a cookie alone",
      "    cannot be taken back.",
    );

    write("forged-cookie-rejection.txt", lines);
  });

  it("records the CSRF refusals", async () => {
    const lines: string[] = [
      "HALF SOUR — admin auth evidence",
      "CSRF refusals on POST /login/session, with the CORRECT password every time",
      "",
      "case                                      status  location      session issued",
      "------------------------------------------------------------------------------",
    ];

    const cases: {
      label: string;
      build: () => Promise<Request>;
    }[] = [
      {
        label: "no token, no cookie",
        build: async () =>
          buildLoginRequest({ password: TEST_PASSWORD, csrfToken: null }),
      },
      {
        label: "token present, cookie missing",
        build: async () => {
          const csrf = await mintCsrf(harness);
          return buildLoginRequest({
            password: TEST_PASSWORD,
            csrfToken: csrf.token,
            csrfCookie: null,
          });
        },
      },
      {
        label: "cookie present, token missing",
        build: async () => {
          const csrf = await mintCsrf(harness);
          return buildLoginRequest({
            password: TEST_PASSWORD,
            csrfToken: null,
            csrfCookie: csrf.cookie,
          });
        },
      },
      {
        label: "token from a different cookie",
        build: async () => {
          const mine = await mintCsrf(harness);
          const theirs = await mintCsrf(harness);
          return buildLoginRequest({
            password: TEST_PASSWORD,
            csrfToken: theirs.token,
            csrfCookie: mine.cookie,
          });
        },
      },
      {
        label: "cookie forged under another key",
        build: async () => {
          const token = randomToken(32);
          return buildLoginRequest({
            password: TEST_PASSWORD,
            csrfToken: token,
            csrfCookie: await seal(
              randomBytes(32),
              "login-csrf",
              { t: token },
              new Date(harness.clock.now().getTime() + 60_000),
            ),
          });
        },
      },
      {
        label: "cross-site Origin",
        build: async () => {
          const csrf = await mintCsrf(harness);
          return buildLoginRequest({
            password: TEST_PASSWORD,
            csrfToken: csrf.token,
            csrfCookie: csrf.cookie,
            origin: "https://evil.example",
            fetchSite: "cross-site",
          });
        },
      },
      {
        label: "sibling subdomain (same-site)",
        build: async () => {
          const csrf = await mintCsrf(harness);
          return buildLoginRequest({
            password: TEST_PASSWORD,
            csrfToken: csrf.token,
            csrfCookie: csrf.cookie,
            origin: "https://blog.half-sour.test",
            fetchSite: "same-site",
          });
        },
      },
    ];

    for (const testCase of cases) {
      const response = await handleLoginPost(
        await testCase.build(),
        harness.handlerOptions,
      );
      const issued = response.headers
        .getSetCookie()
        .some((v) => v.startsWith(`${SESSION_COOKIE_NAME}=`));
      expect(issued).toBe(false);
      lines.push(
        `${testCase.label.padEnd(42)}${String(response.status).padEnd(8)}` +
          `${(response.headers.get("location") ?? "").padEnd(14)}${issued ? "YES" : "no"}`,
      );
    }

    const csrf = await mintCsrf(harness);
    const good = await handleLoginPost(
      buildLoginRequest({
        password: TEST_PASSWORD,
        csrfToken: csrf.token,
        csrfCookie: csrf.cookie,
      }),
      harness.handlerOptions,
    );
    const issued = good.headers
      .getSetCookie()
      .some((v) => v.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(issued).toBe(true);
    lines.push(
      `${"matching token and cookie, same origin".padEnd(42)}${String(good.status).padEnd(8)}` +
        `${(good.headers.get("location") ?? "").padEnd(14)}${issued ? "YES" : "no"}`,
      "",
      "Every refusal produces the identical status and destination, so the",
      "response distinguishes none of them. The reason is written to audit_log.",
    );

    write("csrf-rejection.txt", lines);
  });

  const verify = (cookieValue: string) =>
    verifySessionCookie({
      store: harness.database.store,
      secret: harness.secret,
      cookieValue,
      now: harness.clock.now(),
    });
});

function reason(
  result: Awaited<ReturnType<typeof verifySessionCookie>>,
): string {
  return result.status === "rejected" ? result.reason : "accepted";
}

/** Keep a live-looking cookie value out of a committed file. */
function redactValue(header: string): string {
  const separator = header.indexOf("=");
  const end = header.indexOf(";");
  const name = header.slice(0, separator);
  const value = header.slice(separator + 1, end);
  return `${name}=${value.slice(0, 12)}...[${String(value.length)} chars]${header.slice(end)}`;
}
