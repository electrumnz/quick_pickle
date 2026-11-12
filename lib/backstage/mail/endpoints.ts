/**
 * The two doors mail comes in by. The route files under app/api/mail are one
 * line each and call these.
 *
 *   POST /api/mail/inbound   the body IS the raw email. For a Cloudflare
 *                            Email Worker or any forwarder that holds
 *                            MAIL_INBOUND_SECRET.
 *   POST /api/mail/resend    Resend's webhook, signed by Svix: mail received
 *                            for us, and what became of mail we sent.
 *
 * Neither reads a cookie or knows about a session. Each proves who is
 * calling before it reads a byte of what they sent, answers "not configured"
 * (503) when its secret is not set and never lets anything in instead, and
 * treats an email it already holds as a success that changes nothing.
 *
 * Whatever has to be fetched over the network is fetched before the
 * transaction that stores a message is opened.
 */

import "server-only";

import { and, eq } from "drizzle-orm";

import { mailMessages } from "@/db/schema";
import { getDb } from "@/lib/db/client";
import type { Db } from "@/lib/db/types";
import {
  fetchReceived,
  ResendFetchError,
  type ReceivedEmail,
} from "@/lib/mail/resend";
import {
  bearerToken,
  safeEqual,
  verifySvixSignature,
} from "@/lib/mail/signature";

import { systemCaller } from "../core/actor";
import { execute } from "../core/op";
import { inboundSecret, resendApiKey, resendWebhookSecret } from "./config";
import { ingestRawEmail } from "./ingest";
import { recordProviderEvent, type ProviderEvent } from "./ops-setup";
import { MAX_RAW_BYTES, normaliseAddress, UnreadableMail } from "./parse";

type Env = Record<string, string | undefined>;

export type EndpointDeps = {
  readonly env?: Env;
  readonly db?: Db;
  readonly now?: Date;
  readonly fetch?: typeof fetch;
};

/** A webhook is a few hundred bytes of JSON. This is generous. */
const MAX_WEBHOOK_BYTES = 1024 * 1024;

function answer(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      ...headers,
    },
  });
}

/**
 * One structured line for the server log. The error's class and, if the
 * database raised it, its code. Never its message: a failed query's message
 * can carry the email it was trying to store.
 */
function logFailure(event: string, error: unknown, said?: string): void {
  const cause = error instanceof Error ? error.cause : undefined;
  const code = [error, cause]
    .map((source) =>
      typeof source === "object" && source !== null && "code" in source
        ? String(source.code)
        : "",
    )
    .find((value) => value !== "");
  console.error(
    JSON.stringify({
      event,
      error: error instanceof Error ? error.name : "unknown",
      ...(code === undefined ? {} : { code }),
      ...(said === undefined ? {} : { said }),
    }),
  );
}

/** Read a request body, giving up the moment it passes the limit. */
async function readBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | "too-large"> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return "too-large";
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return "too-large";
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/* ------------------------------------------------------------------------
   POST /api/mail/inbound
   --------------------------------------------------------------------- */

/**
 * Take in one raw email. The caller proves itself with
 * `Authorization: Bearer <MAIL_INBOUND_SECRET>`. It may add `X-Envelope-To`
 * with the address the mail server was told to deliver to.
 */
export async function handleInboundRaw(
  request: Request,
  deps: EndpointDeps = {},
): Promise<Response> {
  const secret = inboundSecret(deps.env);
  if (secret === null) {
    return answer(503, { ok: false, error: "not_configured" });
  }
  const token = bearerToken(request.headers.get("authorization"));
  if (token === null || !safeEqual(token, secret)) {
    return answer(
      401,
      { ok: false, error: "unauthorised" },
      { "www-authenticate": "Bearer" },
    );
  }

  const body = await readBody(request, MAX_RAW_BYTES);
  if (body === "too-large") {
    return answer(413, { ok: false, error: "too_large" });
  }
  if (body.byteLength === 0) return answer(400, { ok: false, error: "empty" });

  try {
    const result = await ingestRawEmail(
      deps.db ?? (await getDb()),
      body,
      {
        recipient:
          normaliseAddress(request.headers.get("x-envelope-to") ?? undefined) ??
          undefined,
        via: "webhook",
      },
      deps.now ?? new Date(),
    );
    return answer(200, { ok: true, result: result.status });
  } catch (error) {
    if (error instanceof UnreadableMail) {
      return answer(422, { ok: false, error: "unreadable" });
    }
    logFailure("mail.inbound_failed", error);
    return answer(500, { ok: false, error: "failed" });
  }
}

/* ------------------------------------------------------------------------
   POST /api/mail/resend
   --------------------------------------------------------------------- */

function field(source: unknown, name: string): unknown {
  return typeof source === "object" && source !== null && name in source
    ? (source as Record<string, unknown>)[name]
    : undefined;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function addresses(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const entry of list.slice(0, 50)) {
    // "Name <a@b>" or a bare address.
    const raw = text(entry);
    const address = normaliseAddress(
      raw === null ? undefined : (/<([^<>]+)>/.exec(raw)?.[1] ?? raw),
    );
    if (address !== null) out.push(address);
  }
  return out;
}

const AFTERWARDS: Readonly<Record<string, ProviderEvent>> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  // The provider took the email and then did not send it.
  "email.failed": "failed",
  "email.suppressed": "failed",
};

/** Resend's ids are UUIDs. Anything else is not looked up. */
const EMAIL_ID = /^[A-Za-z0-9_-]{6,80}$/;

/**
 * Resend's webhook. The Svix signature is checked against the body exactly
 * as it arrived, before that body is read as JSON.
 *
 *   email.received   the payload only describes the email, so the original
 *                    is fetched from Resend and taken in like any other
 *   email.sent, email.delivered, email.bounced, email.complained,
 *   email.failed, email.suppressed
 *                    recorded against the email we sent, along with the
 *                    Message-ID Resend says it really went out with
 *   anything else    answered 200 and left alone
 */
export async function handleResendWebhook(
  request: Request,
  deps: EndpointDeps = {},
): Promise<Response> {
  const secret = resendWebhookSecret(deps.env);
  if (secret === null) {
    return answer(503, { ok: false, error: "not_configured" });
  }
  const body = await readBody(request, MAX_WEBHOOK_BYTES);
  if (body === "too-large") {
    return answer(413, { ok: false, error: "too_large" });
  }
  const now = deps.now ?? new Date();
  const check = verifySvixSignature({
    secret,
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    body,
    now,
  });
  if (!check.ok) {
    return check.reason === "unconfigured"
      ? answer(503, { ok: false, error: "not_configured" })
      : answer(401, { ok: false, error: "bad_signature" });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return answer(400, { ok: false, error: "not_json" });
  }
  const type = text(field(payload, "type")) ?? "";
  const data = field(payload, "data");
  // The id of the email the event is about. `email_id` is what Resend
  // documents; `id` is read too in case that changes.
  const emailId = text(field(data, "email_id")) ?? text(field(data, "id"));
  const db = deps.db ?? (await getDb());

  if (type === "email.received") {
    if (emailId === null || !EMAIL_ID.test(emailId)) {
      logFailure("mail.resend_no_email_id", new Error("no id"));
      return answer(200, { ok: true, result: "ignored" });
    }
    const [held] = await db
      .select({ id: mailMessages.id })
      .from(mailMessages)
      .where(eq(mailMessages.providerId, emailId))
      .limit(1);
    if (held !== undefined)
      return answer(200, { ok: true, result: "duplicate" });

    const apiKey = resendApiKey(deps.env);
    if (apiKey === null) {
      return answer(503, { ok: false, error: "not_configured" });
    }
    let received: ReceivedEmail;
    try {
      received = await fetchReceived(emailId, {
        apiKey,
        fetch: deps.fetch ?? fetch,
        maxBytes: MAX_RAW_BYTES,
      });
    } catch (error) {
      logFailure(
        "mail.resend_fetch_failed",
        error,
        error instanceof ResendFetchError ? error.message : undefined,
      );
      // Not our fault and maybe not for long: let Resend try again.
      return answer(502, { ok: false, error: "fetch_failed" });
    }
    try {
      const result = await ingestRawEmail(
        db,
        received.raw,
        {
          providerId: emailId,
          // Where it was really delivered: the reply address of a message
          // that was only blind-copied to us is nowhere else.
          recipient: received.receivedFor,
          via: "webhook",
        },
        now,
      );
      return answer(200, { ok: true, result: result.status });
    } catch (error) {
      if (error instanceof UnreadableMail) {
        // Sending it again will not make it readable.
        logFailure("mail.resend_unreadable", error);
        return answer(200, { ok: true, result: "unreadable" });
      }
      logFailure("mail.resend_ingest_failed", error);
      return answer(500, { ok: false, error: "failed" });
    }
  }

  const event = AFTERWARDS[type];
  if (event === undefined || emailId === null) {
    return answer(200, { ok: true, result: "ignored" });
  }
  const [ours] = await db
    .select({ status: mailMessages.status, headers: mailMessages.headers })
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.providerId, emailId),
        eq(mailMessages.direction, "out"),
      ),
    )
    .limit(1);
  if (ours === undefined) return answer(200, { ok: true, result: "unknown" });
  // The Message-ID it really went out with. Replies will name this one.
  const reported = (text(field(data, "message_id")) ?? "")
    .replace(/^<|>$/g, "")
    .slice(0, 300);
  const learnsId =
    reported !== "" && ours.headers["qp:provider-message-id"] !== reported;
  const news =
    event === "sent"
      ? false
      : event === "bounced"
        ? ours.status !== "bounced"
        : event === "failed"
          ? ours.status === "sent"
          : ours.headers[
              event === "delivered" ? "qp:delivered" : "qp:complaint"
            ] === undefined;
  if (!news && !learnsId) {
    return answer(200, { ok: true, result: "unchanged" });
  }

  const bounce = field(data, "bounce");
  const kind = `${text(field(bounce, "type")) ?? ""} ${text(field(bounce, "subType")) ?? ""}`;
  const said =
    type === "email.suppressed"
      ? (text(field(field(data, "suppressed"), "message")) ??
        "The mail provider has this address on its own do-not-send list.")
      : event === "failed"
        ? (text(field(field(data, "failed"), "reason")) ?? "")
        : (text(field(bounce, "message")) ?? "");
  try {
    await execute(
      recordProviderEvent,
      {
        providerId: emailId,
        event,
        recipients: addresses(field(data, "to")),
        // Resend reports hard bounces here. Only one that says it is
        // temporary is treated as anything else.
        permanent: !/transient|temporary|soft|undetermined/i.test(kind),
        detail: said.replace(/\s+/g, " ").slice(0, 300),
        reportedMessageId: reported === "" ? null : reported,
      },
      systemCaller("Inbox", "webhook"),
      { db, now },
    );
  } catch (error) {
    logFailure("mail.resend_event_failed", error);
    return answer(500, { ok: false, error: "failed" });
  }
  return answer(200, { ok: true, result: event });
}
