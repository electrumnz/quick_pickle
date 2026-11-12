/**
 * Resend, over plain HTTP. No SDK: one endpoint for sending does not need
 * one, and every call here takes the `fetch` to use so a test can hand in a
 * fake.
 *
 * Two rules run through this file. The API key goes to api.resend.com and
 * nowhere else. And the key never appears in an error, a log line or
 * anything else that leaves this file: whatever a failure says is scrubbed
 * first.
 */

import { MailSendError, type OutgoingMail, type SendResult } from "./types";

const API = "https://api.resend.com";
const TIMEOUT_MS = 20_000;

export type ResendOptions = {
  readonly apiKey: string;
  readonly fetch: typeof fetch;
};

/** Take anything key-shaped out of text that is about to be kept or shown. */
export function scrubSecrets(text: string, apiKey?: string): string {
  let out = text;
  if (apiKey !== undefined && apiKey !== "") {
    out = out.split(apiKey).join("[key removed]");
  }
  return out
    .replace(/\bre_[A-Za-z0-9_-]{8,}/g, "[key removed]")
    .replace(/\bwhsec_[A-Za-z0-9+/=_-]{8,}/g, "[key removed]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [key removed]");
}

function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/** `Quick Pickle <hello@quickpickle.example>`, with the name made safe. */
export function formatAddress(party: {
  readonly address: string;
  readonly name?: string;
}): string {
  const name = (party.name ?? "")
    .replace(/[\r\n"\\<>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (name === "") return party.address;
  return /^[\w .'-]+$/.test(name)
    ? `${name} <${party.address}>`
    : `"${name}" <${party.address}>`;
}

type Refusal = {
  /** Resend's own name for what went wrong: "validation_error" and so on. */
  readonly name: string;
  readonly said: string;
};

/** What Resend said went wrong, read as carefully as an error body deserves. */
async function refusal(response: Response, apiKey: string): Promise<Refusal> {
  let said = "";
  let name = "";
  try {
    const text = (await response.text()).slice(0, 2000);
    try {
      const body: unknown = JSON.parse(text);
      if (typeof body === "object" && body !== null) {
        const record = body as Record<string, unknown>;
        const message = record.message ?? record.error;
        said = typeof message === "string" ? message : "";
        name = typeof record.name === "string" ? record.name.slice(0, 60) : "";
      }
    } catch {
      said = text;
    }
  } catch {
    said = "";
  }
  return { name, said: oneLine(scrubSecrets(said, apiKey), 300) };
}

/**
 * Worth trying again later, with the same key: a timeout, too many at once,
 * a quota that resets, a fault at their end, or "a request with this key is
 * still in flight". Not a key that was already used for a different email:
 * asking again gets the same answer.
 */
function retryable(status: number, name: string): boolean {
  if (status === 409) return name !== "invalid_idempotent_request";
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Did it go? A plain no (bad address, bad key, too many at once) means it
 * did not. A timeout, a fault at their end, or anything about a key that
 * has been seen before means we cannot tell.
 */
function outcomeOf(status: number): "refused" | "unknown" {
  return status === 408 || status === 409 || status >= 500
    ? "unknown"
    : "refused";
}

/**
 * Send one email. Resolves with Resend's id for it. Throws `MailSendError`
 * carrying the status and what Resend said, never the key.
 */
export async function sendWithResend(
  mail: OutgoingMail,
  options: ResendOptions,
): Promise<SendResult> {
  const headers: Record<string, string> = { ...mail.headers };
  // Resend may keep this or replace it with its own. Nothing depends on
  // which: see the note on `messageId` in types.ts.
  if (mail.messageId !== undefined) headers["Message-ID"] = mail.messageId;

  const body = {
    from: formatAddress(mail.from),
    to: mail.to.map((party) => party.address),
    ...(mail.cc !== undefined && mail.cc.length > 0
      ? { cc: mail.cc.map((party) => party.address) }
      : {}),
    ...(mail.replyTo !== undefined ? { reply_to: mail.replyTo.address } : {}),
    subject: mail.subject,
    text: mail.text,
    ...(mail.html !== undefined ? { html: mail.html } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };

  let response: Response;
  try {
    response = await options.fetch(`${API}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": mail.idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : "no answer";
    throw new MailSendError(
      `Resend could not be reached: ${oneLine(scrubSecrets(why, options.apiKey), 200)}`,
      { provider: "resend", status: null, retryable: true, outcome: "unknown" },
    );
  }

  if (!response.ok) {
    const { name, said } = await refusal(response, options.apiKey);
    throw new MailSendError(
      `Resend refused the email (${String(response.status)})${said === "" ? "." : `: ${said}`}`,
      {
        provider: "resend",
        status: response.status,
        retryable: retryable(response.status, name),
        outcome: outcomeOf(response.status),
      },
    );
  }

  let id = "";
  let messageId = "";
  try {
    const answer: unknown = await response.json();
    if (typeof answer === "object" && answer !== null) {
      const record = answer as Record<string, unknown>;
      id = typeof record.id === "string" ? record.id : "";
      // Not in the answer today. Read in case it is one day.
      messageId =
        typeof record.message_id === "string"
          ? oneLine(record.message_id, 300)
          : "";
    }
  } catch {
    id = "";
  }
  if (id === "") {
    throw new MailSendError(
      "Resend took the email but did not say what it called it.",
      {
        provider: "resend",
        status: response.status,
        retryable: false,
        outcome: "unknown",
      },
    );
  }
  return {
    provider: "resend",
    id,
    delivered: true,
    ...(messageId === "" ? {} : { messageId }),
  };
}
