/**
 * Sending email, behind a seam.
 *
 * Everything that sends an email (an order's receipt, a reply from the
 * inbox) hands it to `sendMail` here and does not know what is behind it.
 * `MAIL_PROVIDER` names it:
 *
 *   off     the default, and what an unset variable means. Nothing is sent.
 *           Whoever asked is told so, and writes down why in a sentence.
 *   resend  Resend's HTTP API (./resend.ts). Needs RESEND_API_KEY, and
 *           MAIL_FROM for the address to send from.
 *
 * Any other value throws at once, naming it: a shop that quietly stops
 * sending receipts because somebody mistyped a variable is worse than one
 * that says so.
 *
 * Choosing a provider is not enough to send. Email only really leaves a
 * production deployment with a real database behind it. Never a Vercel
 * preview (unmerged code on copied settings), never a development server,
 * never a back end running on invented records, never a test. In each of
 * those the email is checked exactly as it would be and comes back as "not
 * delivered", and `mailConnection` says why.
 *
 * Nothing in here knows about the back end. It takes an email and sends it.
 */

import { databaseUrl } from "@/lib/db/client";

import { sendWithResend } from "./resend";
import type { MailProvider, OutgoingMail, SendResult } from "./types";

export {
  MailSendError,
  type MailAddress,
  type MailProvider,
  type OutgoingMail,
  type SendOutcome,
  type SendResult,
} from "./types";

type Env = Record<string, string | undefined>;

/* ------------------------------------------------------------------------
   Checks made before any provider sees an email
   --------------------------------------------------------------------- */

const ADDRESS = /^[^\s@<>"(),;:\\]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const LINE_BREAK = /[\r\n]/;

/** Headers that are set from the email's own fields, never from `headers`. */
const OWN_HEADERS = new Set([
  "from",
  "to",
  "cc",
  "bcc",
  "subject",
  "reply-to",
  "message-id",
  "date",
  "sender",
  "return-path",
  "content-type",
  "content-transfer-encoding",
  "mime-version",
  "dkim-signature",
  "received",
]);

/** Is this text one email address, of a shape a mail server will take? */
export function isEmailAddress(text: string): boolean {
  return text.length <= 254 && ADDRESS.test(text);
}

function checkAddress(
  what: string,
  party: { readonly address: string; readonly name?: string },
): void {
  if (!isEmailAddress(party.address)) {
    throw new Error(`The ${what} address is not an email address.`);
  }
  if (party.name !== undefined && LINE_BREAK.test(party.name)) {
    throw new Error(`The ${what} name has a line break in it.`);
  }
}

/**
 * Refuse an email that is malformed, before it gets anywhere. A line break
 * in a subject or a header is how one email is made to carry another.
 */
export function assertSendable(mail: OutgoingMail): void {
  checkAddress("from", mail.from);
  if (mail.to.length === 0) throw new Error("An email needs someone to go to.");
  for (const party of mail.to) checkAddress("to", party);
  for (const party of mail.cc ?? []) checkAddress("cc", party);
  if (mail.replyTo !== undefined) checkAddress("reply-to", mail.replyTo);
  if (mail.subject.trim() === "") throw new Error("An email needs a subject.");
  if (LINE_BREAK.test(mail.subject)) {
    throw new Error("The subject has a line break in it.");
  }
  if (
    mail.messageId !== undefined &&
    !/^<[^<>\s]{3,300}>$/.test(mail.messageId)
  ) {
    throw new Error("The Message-ID is not in angle brackets.");
  }
  for (const [name, value] of Object.entries(mail.headers ?? {})) {
    if (!HEADER_NAME.test(name) || OWN_HEADERS.has(name.toLowerCase())) {
      throw new Error(`"${name}" cannot be set as an extra header.`);
    }
    if (LINE_BREAK.test(value) || value.length > 900) {
      throw new Error(`The ${name} header is not a single line.`);
    }
  }
  if (!/^[\w.:-]{1,200}$/.test(mail.idempotencyKey)) {
    throw new Error("An email needs an idempotency key.");
  }
}

/**
 * The Message-ID for one of our own emails: our id for it, on the domain it
 * is sent from. The same email always gets the same one, so a second try at
 * sending it carries the id the first did. Null when the address has no
 * domain to put it on.
 */
export function messageIdFor(id: string, fromAddress: string): string | null {
  const at = fromAddress.lastIndexOf("@");
  const domain = at < 1 ? "" : fromAddress.slice(at + 1).toLowerCase();
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)) return null;
  if (!/^[\w.-]{3,100}$/.test(id)) return null;
  return `<${id}@${domain}>`;
}

/* ------------------------------------------------------------------------
   Where email may leave from
   --------------------------------------------------------------------- */

const INVENTED =
  "This back end is running on invented records, which never sends email.";

/**
 * Why email is held back in this place, whatever provider is chosen, or null
 * if it may really leave.
 */
export function heldBecause(env: Env = process.env): string | null {
  if (databaseUrl(env) === null) return INVENTED;
  if (env.NODE_ENV === "test") return "Tests never send email.";
  if ((env.VERCEL_ENV ?? "").trim().toLowerCase() === "preview") {
    return "This is a preview deployment, and a preview never sends email.";
  }
  if (env.NODE_ENV !== "production") {
    return "This is a development server, which never sends email.";
  }
  return null;
}

/** The address email is sent from (`MAIL_FROM`), or null if none is set. */
export function mailFrom(env: Env = process.env): string | null {
  const address = (env.MAIL_FROM ?? "").trim().toLowerCase();
  return isEmailAddress(address) ? address : null;
}

/* ------------------------------------------------------------------------
   Choosing
   --------------------------------------------------------------------- */

const VALID = "off, resend";

const NOT_CONNECTED =
  "No mail provider is connected, so emails are written down and not sent.";

function providerName(env: Env): string {
  const name = (env.MAIL_PROVIDER ?? "").trim().toLowerCase();
  return name === "" ? "off" : name;
}

const notAProvider = (name: string) =>
  `MAIL_PROVIDER is "${name.slice(0, 40)}", which is not a mail provider. Valid: ${VALID}.`;

const NO_KEY = 'MAIL_PROVIDER is "resend" but RESEND_API_KEY is not set.';

/** A provider that is handed an email and sends nothing. */
function nothingLeaves(name: string): MailProvider {
  return {
    name,
    delivers: false,
    async send() {
      return { provider: name, id: "", delivered: false };
    },
  };
}

/**
 * The `fetch` a real provider uses when nobody hands one in. Under a test
 * runner that is a refusal: a test that reaches a real provider has to bring
 * its own fake, so no test can ever put a call on the wire.
 */
function networkFetch(): typeof fetch {
  if (process.env.NODE_ENV !== "test") return fetch;
  return async () => {
    throw new Error(
      "A test has to hand in its own fetch. The mail provider is never called from a test.",
    );
  };
}

/**
 * The configured provider. An unknown name, or Resend with no key, is a
 * hard failure and never a quiet fall back to sending nothing. Resend chosen
 * in a place that must not send is a provider that carries Resend's name and
 * sends nothing: the set-up is checked as it will be in production.
 */
export function getMailProvider(
  env: Env = process.env,
  fetcher?: typeof fetch,
): MailProvider {
  const name = providerName(env);
  if (name === "off") return nothingLeaves("off");
  if (name !== "resend") throw new Error(notAProvider(name));
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  if (apiKey === "") throw new Error(NO_KEY);
  if (heldBecause(env) !== null) return nothingLeaves("resend");
  return {
    name: "resend",
    delivers: true,
    send: (mail) =>
      sendWithResend(mail, { apiKey, fetch: fetcher ?? networkFetch() }),
  };
}

export type MailConnection = {
  /** "off", "resend", or what was typed if it is not a provider. */
  readonly provider: string;
  /** True when an email handed over here really leaves. */
  readonly delivers: boolean;
  /** Nothing leaves, on purpose. Why, in a sentence. */
  readonly held: string | null;
  /** The set-up is wrong. What is wrong, in a sentence. Never a secret. */
  readonly problem: string | null;
  /** The settings still to be made before email can leave, by name. */
  readonly missing: readonly string[];
  /** The address email is sent from, when one is set. */
  readonly from: string | null;
};

/**
 * How sending is set up, for a screen to say and for the outbox to act on.
 * Never throws, and never returns a value of a secret: only whether it is
 * there.
 */
export function mailConnection(env: Env = process.env): MailConnection {
  const name = providerName(env);
  const from = mailFrom(env);
  const keySet = (env.RESEND_API_KEY ?? "").trim() !== "";
  const base = {
    provider: name.slice(0, 40),
    from,
    missing: [
      ...(name === "resend" ? [] : ["MAIL_PROVIDER"]),
      ...(keySet ? [] : ["RESEND_API_KEY"]),
      ...(from === null ? ["MAIL_FROM"] : []),
    ],
  };
  const wrong = (problem: string): MailConnection => ({
    ...base,
    delivers: false,
    held: null,
    problem,
  });
  const holding = (held: string): MailConnection => ({
    ...base,
    delivers: false,
    held,
    problem: null,
  });

  if (name === "off") {
    // Invented records say so first, as they do everywhere.
    return holding(databaseUrl(env) === null ? INVENTED : NOT_CONNECTED);
  }
  if (name !== "resend") return wrong(notAProvider(name));
  if (!keySet) return wrong(NO_KEY);
  if (from === null) {
    return wrong(
      (env.MAIL_FROM ?? "").trim() === ""
        ? 'MAIL_PROVIDER is "resend" but MAIL_FROM, the address to send from, is not set.'
        : "MAIL_FROM is not an email address.",
    );
  }
  const held = heldBecause(env);
  if (held !== null) return holding(held);
  return { ...base, delivers: true, held: null, problem: null };
}

/**
 * Send one email through whichever provider is configured. Resolves with
 * `delivered: false` when this is a place nothing leaves from. Throws
 * `MailSendError` if the provider refuses it or cannot be reached, and a
 * plain `Error` if the email itself is malformed or the set-up is wrong.
 */
export async function sendMail(
  mail: OutgoingMail,
  options: { readonly env?: Env; readonly fetch?: typeof fetch } = {},
): Promise<SendResult> {
  assertSendable(mail);
  return getMailProvider(options.env, options.fetch).send(mail);
}
