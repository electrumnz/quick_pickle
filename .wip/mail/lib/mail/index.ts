/**
 * Sending email, behind a seam.
 *
 * Everything that sends an email (a reply from the inbox, an order receipt,
 * a campaign) hands it to `sendMail` here and does not know what is behind
 * it. Which provider that is comes from `MAIL_PROVIDER`:
 *
 *   log     the default when it is unset. Sends nothing. The last 50 emails
 *           are kept in memory so tests can look at them. A deployment
 *           running on this says so on the inbox's settings screen.
 *   resend  Resend's HTTP API (lib/mail/resend.ts). Needs RESEND_API_KEY.
 *
 * Any other value throws at once, naming it: a shop that quietly stops
 * sending receipts because somebody mistyped a variable is worse than one
 * that says so. Adding a provider is one object with a `send` method.
 *
 * Choosing a provider is not enough to send. Email only really leaves when
 * someone has also turned the switch on, `MAIL_SEND=live`, and never from a
 * preview deployment, whatever its settings say: a preview runs unmerged
 * code against copied settings, and a customer must never get an email from
 * one. With the switch off, the same emails are recorded and nothing goes.
 *
 * Nothing in here knows about the back end. It takes an email and sends it.
 */

import { sendWithResend } from "./resend";
import type {
  MailAddress,
  MailProvider,
  OutgoingMail,
  SendResult,
} from "./types";

export {
  MailSendError,
  type MailAddress,
  type MailProvider,
  type OutgoingAttachment,
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

function checkAddress(what: string, party: MailAddress): void {
  if (party.address.length > 254 || !ADDRESS.test(party.address)) {
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

/** A Message-ID of our own: random, on the domain the email is sent from. */
export function newMessageId(fromAddress: string): string {
  const at = fromAddress.lastIndexOf("@");
  const domain = at < 1 ? "" : fromAddress.slice(at + 1).toLowerCase();
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)) {
    throw new Error("A Message-ID needs the domain of a real from address.");
  }
  return `<${crypto.randomUUID()}@${domain}>`;
}

/* ------------------------------------------------------------------------
   Recording instead of sending
   --------------------------------------------------------------------- */

export type LoggedMail = {
  readonly mail: OutgoingMail;
  readonly result: SendResult;
};

const KEPT = 50;

/** Kept on `globalThis` so a development reload does not lose or double it. */
const globalForMail = globalThis as typeof globalThis & {
  __qpLoggedMail?: LoggedMail[];
};
const logged = (): LoggedMail[] => (globalForMail.__qpLoggedMail ??= []);

/** A provider that keeps what it is given and sends nothing. */
function recorder(name: string): MailProvider {
  return {
    name,
    delivers: false,
    async send(mail) {
      const list = logged();
      const before = list.find(
        (entry) => entry.mail.idempotencyKey === mail.idempotencyKey,
      );
      if (before !== undefined) return before.result;
      const result: SendResult = {
        provider: name,
        id: `log-${crypto.randomUUID()}`,
        delivered: false,
      };
      list.push({ mail, result });
      if (list.length > KEPT) list.splice(0, list.length - KEPT);
      return result;
    },
  };
}

const logProvider = recorder("log");

/** What was recorded instead of sent, oldest first. For tests. */
export function sentForTests(): readonly LoggedMail[] {
  return [...logged()];
}

export function clearSentForTests(): void {
  logged().length = 0;
}

/* ------------------------------------------------------------------------
   The switch
   --------------------------------------------------------------------- */

/**
 * Why email is being held back here, or null if it may really leave. Asked
 * only once a provider that delivers has been chosen.
 */
export function heldBecause(env: Env = process.env): string | null {
  if ((env.VERCEL_ENV ?? "").trim().toLowerCase() === "preview") {
    return "This is a preview deployment, and a preview never sends email.";
  }
  if ((env.MAIL_SEND ?? "").trim().toLowerCase() !== "live") {
    return 'Sending is switched off here. Emails are recorded and not sent until MAIL_SEND is set to "live".';
  }
  return null;
}

/* ------------------------------------------------------------------------
   Choosing
   --------------------------------------------------------------------- */

const VALID = "log, resend";

/**
 * The configured provider. An unknown name, or Resend with no key, is a
 * hard failure and never a quiet fall back to sending nothing. Resend with
 * the switch off is a recorder that carries Resend's name: the set-up is
 * checked exactly as it will be in production, and nothing leaves.
 */
export function getMailProvider(
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
): MailProvider {
  const name = (env.MAIL_PROVIDER ?? "").trim().toLowerCase();
  if (name === "" || name === "log") return logProvider;
  if (name === "resend") {
    const apiKey = (env.RESEND_API_KEY ?? "").trim();
    if (apiKey === "") {
      throw new Error(
        'MAIL_PROVIDER is "resend" but RESEND_API_KEY is not set.',
      );
    }
    if (heldBecause(env) !== null) return recorder("resend");
    return {
      name: "resend",
      delivers: true,
      send: (mail) => sendWithResend(mail, { apiKey, fetch: fetcher }),
    };
  }
  throw new Error(
    `MAIL_PROVIDER is "${name.slice(0, 40)}", which is not a mail provider. Valid: ${VALID}.`,
  );
}

export type MailConnection = {
  /** The provider's name, or what was typed if it is not one. */
  readonly provider: string;
  /** True when emails really leave. */
  readonly delivers: boolean;
  /** A provider that could deliver is chosen, and is being held back. Why. */
  readonly held: string | null;
  /** What is wrong with the set-up, if anything. Never a secret. */
  readonly problem: string | null;
};

/** How sending is set up, for a screen to say. Never throws. */
export function mailConnection(env: Env = process.env): MailConnection {
  try {
    const provider = getMailProvider(env);
    return {
      provider: provider.name,
      delivers: provider.delivers,
      held: provider.name === "log" ? null : heldBecause(env),
      problem: null,
    };
  } catch (error) {
    return {
      provider: (env.MAIL_PROVIDER ?? "").trim().toLowerCase().slice(0, 40),
      delivers: false,
      held: null,
      problem: error instanceof Error ? error.message : "It is not set up.",
    };
  }
}

/**
 * Send one email through whichever provider is configured. Throws
 * `MailSendError` if the provider refuses it or cannot be reached, and a
 * plain `Error` if the email itself is malformed or nothing is configured
 * to send with.
 *
 * `record` is for a caller that knows this is no place to send from (the
 * back end running on invented records): the email is checked and recorded,
 * and nothing leaves whatever the settings say.
 */
export async function sendMail(
  mail: OutgoingMail,
  options: {
    readonly env?: Env;
    readonly fetch?: typeof fetch;
    readonly record?: boolean;
  } = {},
): Promise<SendResult> {
  assertSendable(mail);
  const provider = getMailProvider(options.env, options.fetch);
  return options.record === true && provider.delivers
    ? recorder(provider.name).send(mail)
    : provider.send(mail);
}
