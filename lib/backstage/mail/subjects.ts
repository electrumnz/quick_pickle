/**
 * Subject lines, boiled down.
 *
 * A conversation keeps two forms of its subject: one to show (no "Re:", no
 * gateway tags) and one to match on (lower case, and with ticket numbers in
 * brackets taken out as well). Both are worked out here and nowhere else, so
 * the email we send and the reply that comes back to it are always measured
 * the same way.
 *
 * Pure functions: nothing here touches the database.
 */

/** How long a quiet conversation stays open to a reply that lost its headers. */
export const THREAD_WINDOW_DAYS = 30;

/** What mail programs put in front of a reply, in the languages we may see. */
const REPLY_WORD = "re|aw|sv|vs|antw|odp";
/** And in front of a forward. */
const FORWARD_WORD = "fwd?|wg|tr|rv";
const COUNT_AND_COLON = "(?:\\s*[\\[(]\\d{1,3}[\\])])?\\s*[:：]\\s*";

const REPLY_PREFIX = new RegExp(`^(?:${REPLY_WORD})${COUNT_AND_COLON}`, "i");
const ANY_PREFIX = new RegExp(
  `^(?:${REPLY_WORD}|${FORWARD_WORD})${COUNT_AND_COLON}`,
  "i",
);

/** "[External]", "(EXT)", "[SPAM?]": a tag a mail gateway put in front. */
const LEADING_TAG = /^[[(][^\])]{1,40}[\])]\s*/;

/** "[Ticket 48213]", "[CASE-99]": a number in square brackets, hash or no hash. */
const BRACKETED_NUMBER = /\[[^\]]{0,40}\d[^\]]{0,40}\]/g;

/** "(Case 48213-B)", "(ref: 1234)", a bare number: the same in round ones. */
const PARENTHESISED_NUMBER =
  /\((?:(?:ticket|case|ref|reference|request|incident|id|no|nr)\b[^)]{0,30}\d[^)]{0,30}|#?\d[\d\s-]{0,30})\)/gi;

function stripLead(subject: string): string {
  let out = subject.trim();
  for (let pass = 0; pass < 12; pass += 1) {
    const next = out.replace(ANY_PREFIX, "").replace(LEADING_TAG, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * The subject as a person would say it: no "Re:", no gateway tags, one space
 * between words. Used for a new conversation's title.
 */
export function tidySubject(subject: string): string {
  const tidy = stripLead(subject.normalize("NFKC").replace(/\s+/g, " "));
  return (tidy === "" ? "(no subject)" : tidy).slice(0, 200);
}

/**
 * The subject boiled down for matching: lower case, no reply or forward
 * prefixes, no gateway tags, no ticket or case numbers in brackets.
 * "RE: [External] Bottles (Case 48213-B)" and "bottles" share a key.
 */
export function subjectKey(subject: string): string {
  return stripLead(subject.normalize("NFKC").toLowerCase().replace(/\s+/g, " "))
    .replace(BRACKETED_NUMBER, " ")
    .replace(PARENTHESISED_NUMBER, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s.!?…,;:-]+$/, "")
    .trim()
    .slice(0, 200);
}

/**
 * Does the subject say it is a reply? "Re:", "AW:", "SV:" and the like, with
 * any gateway tags in front of them looked past. A forward ("Fwd:") is not a
 * reply: it starts something with someone new.
 */
export function hasReplyPrefix(subject: string): boolean {
  let rest = subject.normalize("NFKC").trim();
  for (let pass = 0; pass < 6; pass += 1) {
    if (REPLY_PREFIX.test(rest)) return true;
    const next = rest.replace(LEADING_TAG, "").trim();
    if (next === rest) return false;
    rest = next;
  }
  return false;
}

/**
 * Subjects that say nothing about what the email is about. Two messages from
 * one person both called "Question" are as likely to be two questions as one.
 */
const GENERIC_SUBJECTS = new Set([
  "hi",
  "hello",
  "hey",
  "hi there",
  "hello there",
  "kia ora",
  "question",
  "a question",
  "quick question",
  "enquiry",
  "inquiry",
  "query",
  "order",
  "my order",
  "an order",
  "new order",
  "invoice",
  "receipt",
  "payment",
  "quote",
  "pricing",
  "help",
  "info",
  "information",
  "thanks",
  "thank you",
  "feedback",
  "contact",
  "contact form",
  "message",
  "new message",
  "no subject",
  "(no subject)",
  "none",
  "urgent",
  "important",
  "update",
  "follow up",
  "following up",
  "request",
  "support",
  "delivery",
  "shipping",
  "test",
  "fyi",
  "wholesale",
]);

/** True when a subject key is too empty or too common to match on. */
export function isGenericSubject(key: string): boolean {
  if (key.length < 4) return true;
  if (!/\p{L}/u.test(key)) return true;
  return GENERIC_SUBJECTS.has(key);
}
