/**
 * Reading a raw email: from the bytes that arrived to the facts the inbox
 * keeps.
 *
 * Nothing here touches the database. It is the slow, careful part of taking
 * a message in (parse the MIME, clean the HTML, work out who it is from and
 * whether a person or a machine wrote it), done before any transaction is
 * opened. ingest.ts takes what this returns and files it.
 *
 * What the inbox shows of a message is its plain text. A message that has
 * no text part has its words read out of its HTML, after that has been
 * cleaned. The HTML itself is never shown (sanitise.ts).
 *
 * Every value that came from the message is the sender's and is treated that
 * way: lengths are capped, control characters are dropped, addresses are
 * checked for shape, and nothing is trusted because of where it sat.
 */

import { createHash } from "node:crypto";

import { convert as htmlToText } from "html-to-text";
import PostalMime, { type Address, type Email } from "postal-mime";

import { snippetOf, splitReply } from "./reply";
import {
  MAX_HTML_CHARS,
  normaliseContentId,
  sanitiseForStorage,
} from "./sanitise";
import type { MailKind } from "./threading";
import { TOKEN_HEADER } from "./token";

/** The most one email may weigh. The endpoints refuse more before reading it. */
export const MAX_RAW_BYTES = 25 * 1024 * 1024;

const MAX_TEXT_CHARS = 300_000;
const MAX_ATTACHMENTS = 40;
const MAX_ADDRESSES = 100;
const MAX_REFERENCES = 50;

/** The message could not be read as an email at all. */
export class UnreadableMail extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreadableMail";
  }
}

export type MailParty = {
  /** Lower-cased. */
  readonly address: string;
  readonly name: string;
};

export type ParsedAttachment = {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  /** Without angle brackets, lower-cased. For a picture shown in the body. */
  readonly contentId: string | null;
  readonly inline: boolean;
};

/** What a delivery report says happened to something we sent. */
export type BounceInfo = {
  /** Message-IDs it names as the original, most trusted first. */
  readonly originalMessageIds: readonly string[];
  /** Reply tokens found in the original's headers. Unchecked. */
  readonly tokens: readonly string[];
  /** The addresses it says could not be reached. */
  readonly recipients: readonly string[];
  /** Delivery failed, as opposed to "delayed" or "delivered". */
  readonly failed: boolean;
  /** The address itself is no good (5.x.x), as opposed to full or busy. */
  readonly permanent: boolean;
  /** The mail system's own words, shortened. */
  readonly diagnostic: string;
};

export type ParsedMail = {
  /** The RFC 5322 Message-ID with its angle brackets, or null if it has none. */
  readonly messageId: string | null;
  /** The message it says it answers, and every id that header carried. */
  readonly inReplyTo: string | null;
  readonly inReplyToAll: readonly string[];
  /** The References header, oldest first. */
  readonly refs: readonly string[];
  readonly from: MailParty;
  readonly replyTo: string | null;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  /** Every address it was sent or delivered to, for finding the mailbox. */
  readonly recipients: readonly string[];
  readonly subject: string;
  /** When it says it was sent, if that could be read. */
  readonly sentAt: Date | null;
  /** Headers worth keeping, lower-cased names. */
  readonly headers: Readonly<Record<string, string>>;
  /** Who or what wrote it, and how we could tell. */
  readonly kind: MailKind;
  readonly kindBecause: string | null;
  readonly bounce: BounceInfo | null;
  /** Plain text, with the quoted earlier messages still in it. */
  readonly textBody: string;
  /** A cleaned copy of the HTML to keep. The original stays in the raw file. */
  readonly htmlBody: string | null;
  /** Pictures the HTML asks for: its own, and other people's servers'. */
  readonly pictures: number;
  /** It had no text part, so its words were read out of its HTML. */
  readonly textFromHtml: boolean;
  /** What the sender wrote this time: no quotes, no sign-off. */
  readonly fresh: string;
  /** The earlier messages it quotes underneath, if any. */
  readonly quoted: string;
  readonly snippet: string;
  readonly attachments: readonly ParsedAttachment[];
  /** Things left out, in sentences, for the record. */
  readonly skipped: readonly string[];
  /** Reply tokens in the message's own headers: our own mail come back. */
  readonly ownTokens: readonly string[];
  readonly rawSha256: string;
};

/* ------------------------------------------------------------------------
   Small readers
   --------------------------------------------------------------------- */

// Everything below a space except tab and line feed, and the delete character.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

function oneLine(value: string | undefined, max: number): string {
  return (value ?? "")
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** An address in the shape we store: lower case, one @, no spaces or brackets. */
export function normaliseAddress(value: string | undefined): string | null {
  const address = (value ?? "").trim().toLowerCase();
  if (address.length < 3 || address.length > 254) return null;
  return /^[^\s@<>"(),;:\\]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(address)
    ? address
    : null;
}

function parties(list: readonly Address[] | undefined): MailParty[] {
  const out = new Map<string, MailParty>();
  for (const entry of list ?? []) {
    const members = entry.group ?? [entry];
    for (const member of members) {
      const address = normaliseAddress(member.address);
      if (address === null || out.has(address)) continue;
      out.set(address, { address, name: oneLine(member.name, 200) });
      if (out.size >= MAX_ADDRESSES) return [...out.values()];
    }
  }
  return [...out.values()];
}

const MESSAGE_ID = /<[^<>\s]{1,300}>/g;

function messageIds(value: string | undefined): string[] {
  return (value ?? "").match(MESSAGE_ID) ?? [];
}

function oneMessageId(value: string | undefined): string | null {
  const [first] = messageIds(value);
  if (first !== undefined) return first;
  const bare = (value ?? "").trim();
  return /^[^\s<>]{3,300}$/.test(bare) && bare.includes("@")
    ? `<${bare}>`
    : null;
}

function headerValues(email: Email, key: string): string[] {
  return email.headers
    .filter((header) => header.key === key)
    .map((header) => header.value);
}

function firstHeader(email: Email, key: string): string | null {
  const [value] = headerValues(email, key);
  return value === undefined ? null : value.trim();
}

function toBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === "string") return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

/* ------------------------------------------------------------------------
   Person or machine
   --------------------------------------------------------------------- */

const NO_REPLY_LOCAL =
  /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster|bounces?)(?:[+\-_.].*)?$/i;

/** The subjects out-of-office replies are sent under, in a few languages. */
const AUTO_REPLY_SUBJECT =
  /^(?:auto(?:matic)?[\s-]?(?:repl(?:y|ies)|response)|autoreply|out of (?:the )?office|abwesenheits|réponse automatique|respuesta automática|automatisch antwoord)/i;

/**
 * Sort a message into person, auto-reply, bulk or bounce, with the reason.
 * Tried in that order of certainty: a delivery report first, then anything
 * that says it is an automatic answer, then anything sent in bulk. What is
 * left is a person, which is the only kind that can ask us for a reply.
 */
function classify(
  email: Email,
  from: MailParty,
  subject: string,
  bounce: BounceInfo | null,
  returnPathEmpty: boolean,
): { kind: MailKind; because: string | null } {
  if (bounce !== null) {
    return { kind: "bounce", because: "it is a mail system's delivery report" };
  }

  const auto = (firstHeader(email, "auto-submitted") ?? "").toLowerCase();
  const precedence = (
    firstHeader(email, "precedence") ??
    firstHeader(email, "x-precedence") ??
    ""
  ).toLowerCase();
  if (auto.startsWith("auto-replied")) {
    return { kind: "auto-reply", because: "it says it is an automatic reply" };
  }
  for (const name of ["x-autoreply", "x-autorespond", "x-autoresponder"]) {
    if (firstHeader(email, name) !== null) {
      return {
        kind: "auto-reply",
        because: "it says it is an automatic reply",
      };
    }
  }
  if (/^auto[-_]?repl/.test(precedence)) {
    return { kind: "auto-reply", because: "it says it is an automatic reply" };
  }
  if (AUTO_REPLY_SUBJECT.test(subject)) {
    return {
      kind: "auto-reply",
      because: "its subject is an out-of-office reply's",
    };
  }

  if (auto !== "" && !/^no\b/.test(auto)) {
    return { kind: "bulk", because: "it says it was sent automatically" };
  }
  if (/^(?:bulk|junk|list)\b/.test(precedence)) {
    return { kind: "bulk", because: "it is marked as bulk mail" };
  }
  if (
    firstHeader(email, "list-id") !== null ||
    firstHeader(email, "list-unsubscribe") !== null
  ) {
    return { kind: "bulk", because: "it came through a mailing list" };
  }
  // Ordinary mail programs set this header with other values, so only the
  // one that means "answer nothing" is taken as a machine's.
  if (/\ball\b/i.test(firstHeader(email, "x-auto-response-suppress") ?? "")) {
    return {
      kind: "bulk",
      because: "its sender asked for no automatic replies at all",
    };
  }
  const local = from.address.slice(0, from.address.lastIndexOf("@"));
  if (NO_REPLY_LOCAL.test(local)) {
    return { kind: "bulk", because: "it is from a no-reply address" };
  }
  if (returnPathEmpty) {
    return {
      kind: "bulk",
      because: "it has no return address, the way notices do",
    };
  }
  return { kind: "person", because: null };
}

/* ------------------------------------------------------------------------
   Delivery reports
   --------------------------------------------------------------------- */

type ReportedRecipient = {
  readonly address: string | null;
  readonly action: string;
  readonly status: string;
  readonly diagnostic: string;
};

/** The per-recipient blocks of a message/delivery-status part (RFC 3464). */
function readDeliveryStatus(text: string): ReportedRecipient[] {
  const out: ReportedRecipient[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const fields = new Map<string, string>();
    let last: string | null = null;
    for (const line of block.split("\n")) {
      const folded = /^\s+\S/.test(line);
      const field = /^([A-Za-z][A-Za-z-]{1,40}):\s*(.*)$/.exec(line);
      if (folded && last !== null) {
        fields.set(last, `${fields.get(last) ?? ""} ${line.trim()}`);
      } else if (field !== null) {
        last = (field[1] ?? "").toLowerCase();
        if (!fields.has(last)) fields.set(last, (field[2] ?? "").trim());
      }
    }
    const recipient =
      fields.get("final-recipient") ?? fields.get("original-recipient");
    if (recipient === undefined) continue;
    const afterType = recipient.includes(";")
      ? recipient.slice(recipient.indexOf(";") + 1)
      : recipient;
    const diagnostic = fields.get("diagnostic-code") ?? "";
    out.push({
      address: normaliseAddress(afterType.trim().replace(/^<|>$/g, "")),
      action: (fields.get("action") ?? "").toLowerCase(),
      status: fields.get("status") ?? "",
      diagnostic: diagnostic.includes(";")
        ? diagnostic.slice(diagnostic.indexOf(";") + 1).trim()
        : diagnostic,
    });
  }
  return out;
}

const decodeLatin = (bytes: Uint8Array) =>
  new TextDecoder("latin1").decode(bytes);

async function readBounce(
  email: Email,
  from: MailParty,
  isReport: boolean,
  returnPathEmpty: boolean,
): Promise<BounceInfo | null> {
  const local = from.address.slice(0, from.address.lastIndexOf("@"));
  const fromTheMailSystem = /^(?:mailer[-_.]?daemon|postmaster)$/i.test(local);
  const statusParts = email.attachments.filter((part) =>
    /^message\/(?:global-)?delivery-status$/.test(part.mimeType),
  );
  if (
    !isReport &&
    statusParts.length === 0 &&
    !(returnPathEmpty && fromTheMailSystem)
  ) {
    return null;
  }

  const originalMessageIds: string[] = [];
  const tokens: string[] = [];

  // The message that came back, or just its headers, rides along as a part.
  const originals = email.attachments
    .filter((part) =>
      /^(?:message\/rfc822|message\/global|text\/rfc822-headers|message\/global-headers)$/.test(
        part.mimeType,
      ),
    )
    .slice(0, 3);
  for (const part of originals) {
    try {
      const original = await PostalMime.parse(toBytes(part.content), {
        maxRfc822NestingDepth: 0,
      });
      const id = oneMessageId(original.messageId);
      if (id !== null) originalMessageIds.push(id);
      for (const value of headerValues(original, TOKEN_HEADER.toLowerCase())) {
        tokens.push(oneLine(value, 80));
      }
    } catch {
      // A part we cannot read tells us nothing. Carry on with the others.
    }
  }

  // Older mail systems paste the original under their note instead.
  const text = (email.text ?? "").slice(0, 200_000);
  for (const match of text.matchAll(/^message-id:\s*(<[^<>\s]{1,300}>)/gim)) {
    if (match[1] !== undefined) originalMessageIds.push(match[1]);
  }
  for (const match of text.matchAll(
    /^x-qp-conversation:\s*([a-z0-9-]{10,80})\s*$/gim,
  )) {
    if (match[1] !== undefined) tokens.push(match[1]);
  }
  // Last, what the report itself says it answers.
  originalMessageIds.push(...messageIds(email.inReplyTo));
  originalMessageIds.push(...messageIds(email.references).reverse());

  const reported = statusParts.flatMap((part) =>
    readDeliveryStatus(decodeLatin(toBytes(part.content))),
  );
  const recipients = new Set<string>();
  for (const entry of reported) {
    if (entry.address !== null) recipients.add(entry.address);
  }
  for (const value of headerValues(email, "x-failed-recipients")) {
    for (const piece of value.split(",")) {
      const address = normaliseAddress(piece);
      if (address !== null) recipients.add(address);
    }
  }

  const failures = reported.filter((entry) => entry.action === "failed");
  // With no machine-readable report, a note from the mail system with our
  // message attached is taken to be a failure, but never a permanent one.
  const failed = reported.length === 0 ? true : failures.length > 0;
  const permanent = failures.some((entry) => entry.status.startsWith("5"));
  const diagnostic =
    failures.find((entry) => entry.diagnostic !== "")?.diagnostic ??
    reported.find((entry) => entry.diagnostic !== "")?.diagnostic ??
    "";

  return {
    originalMessageIds: [...new Set(originalMessageIds)].slice(0, 20),
    tokens: [...new Set(tokens)].slice(0, 5),
    recipients: [...recipients].slice(0, 20),
    failed,
    permanent,
    diagnostic: oneLine(diagnostic, 300),
  };
}

/* ------------------------------------------------------------------------
   Attachments
   --------------------------------------------------------------------- */

const MIME_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,60}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,60}$/;

const NAMES_BY_TYPE: Readonly<Record<string, string>> = {
  "message/delivery-status": "delivery-report.txt",
  "message/global-delivery-status": "delivery-report.txt",
  "text/rfc822-headers": "original-headers.txt",
  "message/global-headers": "original-headers.txt",
  "message/rfc822": "original-message.eml",
  "text/calendar": "invitation.ics",
};

function attachmentsOf(
  email: Email,
  skipped: string[] = [],
): ParsedAttachment[] {
  const out: ParsedAttachment[] = [];
  for (const [index, part] of email.attachments.entries()) {
    if (out.length >= MAX_ATTACHMENTS) {
      skipped.push(
        `Only the first ${String(MAX_ATTACHMENTS)} attachments were kept. The rest are in the original.`,
      );
      break;
    }
    const type = part.mimeType.trim().toLowerCase();
    const contentType = MIME_TYPE.test(type)
      ? type
      : "application/octet-stream";
    const named = oneLine(part.filename ?? undefined, 200);
    const contentId =
      part.contentId === undefined
        ? null
        : normaliseContentId(oneLine(part.contentId, 250));
    out.push({
      filename:
        named !== ""
          ? named
          : (NAMES_BY_TYPE[contentType] ?? `attachment-${String(index + 1)}`),
      contentType,
      bytes: toBytes(part.content),
      contentId: contentId === null || contentId === "" ? null : contentId,
      inline: part.disposition === "inline" || part.related === true,
    });
  }
  return out;
}

/* ------------------------------------------------------------------------
   The whole message
   --------------------------------------------------------------------- */

const KEPT_HEADERS = [
  "auto-submitted",
  "precedence",
  "list-id",
  "list-unsubscribe",
  "x-auto-response-suppress",
  "return-path",
  "thread-index",
  "thread-topic",
  "date",
  "delivered-to",
  "x-original-to",
  "sender",
  "x-mailer",
  "user-agent",
  "x-failed-recipients",
  "authentication-results",
  "received-spf",
  "content-type",
];

function isLimitError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  return [
    "EMAXNESTINGDEPTH",
    "EMAXHEADERSIZE",
    "EMAXPARTCOUNT",
    "EMAXFORWARDEDADDRESSES",
  ].includes(code);
}

/**
 * Parse the MIME of a raw email. A delivery report is read with the message
 * that came back kept as a part of its own, so it can be looked into and so
 * it does not run on into the mail system's note above it.
 */
async function parseMime(raw: Uint8Array): Promise<Email> {
  const read = async (options: { forceRfc822Attachments?: boolean }) => {
    try {
      return await PostalMime.parse(raw, options);
    } catch (error) {
      if (isLimitError(error)) {
        throw new UnreadableMail(
          "That message is built too deep or too wide to be read safely.",
        );
      }
      throw error;
    }
  };
  const email = await read({});
  const contentType = (firstHeader(email, "content-type") ?? "").toLowerCase();
  return contentType.startsWith("multipart/report")
    ? read({ forceRfc822Attachments: true })
    : email;
}

/** The HTML a message carries, or null if it has none or far too much. */
function originalHtml(email: Email): string | null {
  const html = email.html ?? "";
  return html.trim() === "" || html.length > MAX_HTML_CHARS ? null : html;
}

/**
 * Read a raw email. `envelopeRecipient` is the address the mail server was
 * told to deliver to, when the forwarder knows it: it finds the mailbox, and
 * the reply token, for a message that was only ever blind-copied to us.
 */
export async function parseRawEmail(
  raw: Uint8Array,
  envelopeRecipient?: string | readonly string[],
): Promise<ParsedMail> {
  if (raw.byteLength === 0) throw new UnreadableMail("That message is empty.");
  if (raw.byteLength > MAX_RAW_BYTES) {
    throw new UnreadableMail("That message is over 25 MB.");
  }

  const email = await parseMime(raw);
  const contentType = (firstHeader(email, "content-type") ?? "").toLowerCase();
  const isReport = contentType.startsWith("multipart/report");

  const skipped: string[] = [];
  const [sender] = parties(email.from === undefined ? [] : [email.from]);
  const [onBehalf] = parties(email.sender === undefined ? [] : [email.sender]);
  const from: MailParty = sender ??
    onBehalf ?? { address: "unknown@unknown.invalid", name: "" };

  const to = parties(email.to).map((party) => party.address);
  const cc = parties(email.cc).map((party) => party.address);
  const recipients = new Set<string>([...to, ...cc]);
  const envelope =
    envelopeRecipient === undefined
      ? []
      : typeof envelopeRecipient === "string"
        ? [envelopeRecipient]
        : envelopeRecipient.slice(0, 10);
  for (const value of [
    email.deliveredTo,
    firstHeader(email, "x-original-to") ?? undefined,
    ...envelope,
  ]) {
    const address = normaliseAddress(value);
    if (address !== null) recipients.add(address);
  }

  const subject = oneLine(email.subject, 500);
  const returnPath = firstHeader(email, "return-path");
  const returnPathEmpty = returnPath !== null && /^<\s*>$/.test(returnPath);
  const bounce = await readBounce(email, from, isReport, returnPathEmpty);
  const { kind, because } = classify(
    email,
    from,
    subject,
    bounce,
    returnPathEmpty,
  );

  const headers: Record<string, string> = {};
  for (const key of KEPT_HEADERS) {
    const value = firstHeader(email, key);
    if (value !== null && value !== "") headers[key] = oneLine(value, 500);
  }

  // A cleaned copy of the HTML, to keep beside the text and to read the
  // words from when there is no text part. It is never shown as HTML.
  let htmlBody: string | null = null;
  let pictures = 0;
  if ((email.html ?? "").length > MAX_HTML_CHARS) {
    skipped.push(
      "The formatted version was too big to keep. The plain text and the original are here.",
    );
  } else {
    const html = originalHtml(email);
    if (html !== null) {
      const cleaned = sanitiseForStorage(html);
      htmlBody = cleaned.html === "" ? null : cleaned.html;
      pictures = cleaned.pictures;
    }
  }

  let textBody = (email.text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "");
  let textFromHtml = false;
  if (textBody.trim() === "" && htmlBody !== null) {
    textBody = htmlToText(htmlBody, {
      wordwrap: false,
      selectors: [{ selector: "img", format: "skip" }],
    });
    textFromHtml = textBody.trim() !== "";
  }
  if (textBody.length > MAX_TEXT_CHARS) {
    textBody = `${textBody.slice(0, MAX_TEXT_CHARS)}\n\n[The rest of this message is in the original.]`;
    skipped.push("The text was very long, so only the start of it is shown.");
  }
  textBody = textBody.trim();

  const split = splitReply(textBody);
  const sent = Date.parse(email.date ?? "");

  return {
    messageId: oneMessageId(email.messageId),
    inReplyTo: oneMessageId(email.inReplyTo),
    inReplyToAll: messageIds(email.inReplyTo).slice(0, 5),
    refs: messageIds(email.references).slice(-MAX_REFERENCES),
    from,
    replyTo: parties(email.replyTo)[0]?.address ?? null,
    to,
    cc,
    recipients: [...recipients],
    subject,
    // postal-mime gives an ISO instant when it could read the Date header.
    sentAt:
      /^\d{4}-\d{2}-\d{2}T.*Z$/.test(email.date ?? "") && !Number.isNaN(sent)
        ? new Date(sent)
        : null,
    headers,
    kind,
    kindBecause: because,
    bounce,
    textBody,
    htmlBody,
    pictures,
    textFromHtml,
    fresh: split.fresh,
    quoted: split.segments
      .filter((segment) => segment.kind === "quoted")
      .map((segment) => segment.text)
      .join("\n")
      .slice(0, 20_000),
    snippet: snippetOf(split.fresh),
    attachments: attachmentsOf(email, skipped),
    skipped,
    ownTokens: headerValues(email, TOKEN_HEADER.toLowerCase())
      .map((value) => oneLine(value, 80))
      .filter((value) => value !== "")
      .slice(0, 3),
    rawSha256: createHash("sha256").update(raw).digest("hex"),
  };
}
