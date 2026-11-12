/**
 * Record ids: a short prefix that says what the thing is, then 20 characters
 * a person can read back over the phone ("ord_7k2m9x4q8b6t3n5h2w4c").
 *
 * No 0/O, 1/I/L or U. Random, not sequential: an id is not a count of how
 * many orders or customers there have been, and cannot be guessed from the
 * one before it. Sort by `created_at`, never by id.
 */

const ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";

export type IdPrefix =
  | "usr" // staff user
  | "ses" // session
  | "aud" // audit entry
  | "evt" // domain event
  | "cus" // customer
  | "ord" // order
  | "oli" // order line
  | "rfd" // refund
  | "crw" // Pickle Crew member
  | "bat" // batch
  | "stk" // stock movement
  | "sup" // supplier
  | "mat" // material (bottles, caps, labels)
  | "pur" // purchase order
  | "pol" // purchase order line
  | "mbx" // mailbox (an address of ours)
  | "con" // email contact
  | "mlk" // link from a conversation to an order, customer and so on
  | "msg" // email message
  | "cnv" // email conversation
  | "att" // email attachment
  | "tpl" // saved reply or template
  | "out" // outbound email
  | "cmp" // campaign
  | "snd" // one campaign email to one person
  | "pst" // social post
  | "lnk" // tracked link
  | "rev" // review
  | "prt" // partner (club, stockist)
  | "pcs" // something a partnership cost
  | "pro" // promo code
  | "doc" // document
  | "ver" // document version
  | "tsk" // task
  | "qst" // open question
  | "cpl" // compliance register item
  | "cst" // cost item, for the budget
  | "aut" // automation
  | "run" // automation or routine run
  | "apr" // approval request
  | "fil" // stored file
  | "tok"; // api or oauth token

export function newId(prefix: IdPrefix, length = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}
