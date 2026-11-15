/**
 * Every operation the back end has, in one list, and which of them a bot
 * may be offered.
 *
 * A screen imports the operations it uses. A connection cannot: it is asked
 * for an operation by name, so it needs them all in one place. This is that
 * place, and nothing else needs it.
 *
 * Three rules decide what a bot is offered. They are here, in one file, so
 * that adding an operation somewhere else cannot quietly hand it to a bot:
 *
 *   1. Nothing an owner alone may do. A bot is never an owner, so it is not
 *      shown what it could never run.
 *   2. Nothing that is the system's own work: recording an order or a
 *      payment, taking in mail, counting a visit, the clock's rounds, the
 *      connection's own plumbing. Those say what is true because the shop,
 *      a payment processor or a mail provider said so. A bot saying so is
 *      not the same thing. They are listed by name in `SYSTEM_ONLY`.
 *   3. Nothing that puts saved words in front of customers. Publishing a
 *      page, approving a campaign or a caption, publishing a review,
 *      switching a special on: each of those says yes to words that are
 *      kept somewhere else and could be changed after the asking. So a
 *      person does it, on the screen that has the words on it. A bot is
 *      told the operation is there and where a person does it
 *      (`PEOPLE_ONLY`).
 *   4. Everything else is offered, and what it may do with each is decided
 *      where it is run (./run.ts): look, change, or ask a person first.
 *
 * tests/backstage/connect-catalogue.test.ts reads the source for every
 * operation there is and fails if one is missing from here, if a name in
 * `SYSTEM_ONLY` is not a real operation, or if the list of what is held
 * back has changed without the test being told.
 */

import "server-only";

import { z } from "zod";

import type { Op } from "../core/op";

import * as activityOps from "../activity/ops";
import * as clockOps from "../clock/ops";
import * as connectApprovals from "./approvals";
import * as connectOauth from "./oauth";
import * as crewOps from "../crew/ops";
import * as customersOps from "../customers/ops";
import * as digestOps from "../digest/ops";
import * as limitsOps from "../limits/ops";
import * as mailIngest from "../mail/ingest";
import * as mailOpsReply from "../mail/ops-reply";
import * as mailOpsSetup from "../mail/ops-setup";
import * as mailOpsThread from "../mail/ops-thread";
import * as mailOps from "../mail/ops";
import * as mailOutbound from "../mail/outbound";
import * as marketingCampaigns from "../marketing/campaigns";
import * as marketingCollabs from "../marketing/collabs";
import * as marketingLinks from "../marketing/links";
import * as marketingOverview from "../marketing/overview";
import * as marketingPartners from "../marketing/partners";
import * as marketingPromoCodes from "../marketing/promo-codes";
import * as marketingReviews from "../marketing/reviews";
import * as marketingSocial from "../marketing/social";
import * as marketingSpecials from "../marketing/specials";
import * as numbersBooks from "../numbers/books";
import * as numbersOps from "../numbers/ops";
import * as ordersCourier from "../orders/courier";
import * as ordersDisputes from "../orders/disputes";
import * as ordersEmails from "../orders/emails";
import * as ordersOps from "../orders/ops";
import * as ordersOutsideRefunds from "../orders/outside-refunds";
import * as ordersPayments from "../orders/payments";
import * as ordersRefunds from "../orders/refunds";
import * as ordersShipDate from "../orders/ship-date";
import * as pagesOps from "../pages/ops";
import * as pagesRoutingOps from "../pages/routing-ops";
import * as plansCompliance from "../plans/compliance";
import * as plansCosts from "../plans/costs";
import * as plansDocuments from "../plans/documents";
import * as plansNeeds from "../plans/needs";
import * as plansOps from "../plans/ops";
import * as plansQuestions from "../plans/questions";
import * as plansStarterLoad from "../plans/starter/load";
import * as plansTasks from "../plans/tasks";
import * as shopOps from "../shop/ops";
import * as staffOps from "../staff/ops";
import * as stockBatchStates from "../stock/batch-states";
import * as stockBatches from "../stock/batches";
import * as stockHandMovements from "../stock/hand-movements";
import * as stockMaterials from "../stock/materials";
import * as stockOrderStock from "../stock/order-stock";
import * as stockPicture from "../stock/picture";
import * as stockPurchaseStates from "../stock/purchase-states";
import * as stockPurchasing from "../stock/purchasing";
import * as stockRecallList from "../stock/recall-list";
import * as stockSuppliers from "../stock/suppliers";
import * as todayOps from "../today/ops";

const MODULES: readonly Readonly<Record<string, unknown>>[] = [
  activityOps,
  clockOps,
  connectApprovals,
  connectOauth,
  crewOps,
  customersOps,
  digestOps,
  limitsOps,
  mailIngest,
  mailOpsReply,
  mailOpsSetup,
  mailOpsThread,
  mailOps,
  mailOutbound,
  marketingCampaigns,
  marketingCollabs,
  marketingLinks,
  marketingOverview,
  marketingPartners,
  marketingPromoCodes,
  marketingReviews,
  marketingSocial,
  marketingSpecials,
  numbersBooks,
  numbersOps,
  ordersCourier,
  ordersDisputes,
  ordersEmails,
  ordersOps,
  ordersOutsideRefunds,
  ordersPayments,
  ordersRefunds,
  ordersShipDate,
  pagesOps,
  pagesRoutingOps,
  plansCompliance,
  plansCosts,
  plansDocuments,
  plansNeeds,
  plansOps,
  plansQuestions,
  plansStarterLoad,
  plansTasks,
  shopOps,
  staffOps,
  stockBatchStates,
  stockBatches,
  stockHandMovements,
  stockMaterials,
  stockOrderStock,
  stockPicture,
  stockPurchaseStates,
  stockPurchasing,
  stockRecallList,
  stockSuppliers,
  todayOps,
];

function isOp(value: unknown): value is Op {
  if (typeof value !== "object" || value === null) return false;
  const op = value as Partial<Record<keyof Op, unknown>>;
  return (
    typeof op.name === "string" &&
    typeof op.title === "string" &&
    typeof op.description === "string" &&
    typeof op.access === "string" &&
    typeof op.effect === "string" &&
    typeof op.run === "function" &&
    typeof op.input === "object"
  );
}

/** Every operation, by name. */
export const ALL_OPS: ReadonlyMap<string, Op> = (() => {
  const all = new Map<string, Op>();
  for (const exported of MODULES) {
    for (const value of Object.values(exported)) {
      if (!isOp(value)) continue;
      const known = all.get(value.name);
      if (known !== undefined && known !== value) {
        throw new Error(`Two operations are called ${value.name}`);
      }
      all.set(value.name, value);
    }
  }
  return all;
})();

/**
 * The system's own work. Never offered to a bot, whatever its role.
 *
 * Each of these is run by the shop, a webhook, a listener or the clock, on
 * the word of something that knows (a payment processor saying money came,
 * a mail provider saying an email bounced), or is the plumbing of signing
 * in and connecting. A bot naming one of them is told there is no such
 * operation.
 */
export const SYSTEM_ONLY: ReadonlySet<string> = new Set([
  // Orders and money: true because the shop or the processor said so.
  "orders.record",
  "orders.attachPayment",
  "orders.markPaid",
  "orders.paymentExpired",
  "orders.paymentState",
  "orders.refundSettled",
  "orders.refundsSeen",
  "orders.disputeSeen",
  // Mail: what arrived, and what became of what was sent.
  "mail.ingest",
  "mail.recordSent",
  "mail.recordNotSent",
  "mail.recordFailed",
  "mail.recordProviderEvent",
  // Campaigns: the send queue and the clock's part in it.
  "campaigns.due",
  "campaigns.queue",
  "campaigns.sendDue",
  "campaigns.markSends",
  "campaigns.findSend",
  "campaigns.noteTrouble",
  // The shop's own questions, asked on a visitor's behalf.
  "crew.join",
  "crew.standing",
  "limits.hit",
  "limits.giveBack",
  "links.resolve",
  "links.countClick",
  "numbers.record",
  "pages.resolve",
  "pages.routing",
  "promoCodes.check",
  "promoCodes.peek",
  "promoCodes.crewWelcome",
  "reviews.submit",
  "specials.current",
  "specials.worth",
  // Who can sign in. People only, and owners at that.
  "staff.list",
  "staff.createFirstOwner",
  "staff.invite",
  "staff.update",
  "staff.sendPasswordLink",
  "staff.setPasswordWithToken",
  // The connection's own plumbing, and the yes that only a person gives.
  "connect.status",
  "connect.setOn",
  "connect.register",
  "connect.checkRequest",
  "connect.grant",
  "connect.exchange",
  "connect.refresh",
  "connect.cutOffForReuse",
  "connect.verify",
  "connect.list",
  "connect.cutOff",
  "approvals.ask",
  "approvals.begin",
  "approvals.finish",
  "approvals.decline",
]);

/**
 * For a person to do, on the screen where the words are. Never run for a
 * bot, with a yes or without one.
 *
 * Each of these puts words in front of customers that are not in what the
 * bot would hand over: they are kept on a page, a campaign, a post, a
 * review or a special, and a draft can be changed between the asking and
 * the yes. A person saying yes from a list of requests would be saying yes
 * to words they were not shown. So it is done where the words are on the
 * screen, by the person reading them.
 *
 * Beside each is where that is, said to the bot so it can tell the person.
 */
export const PEOPLE_ONLY: Readonly<Record<string, string>> = {
  "pages.publish": "on the page's own screen, under Marketing, Landing pages",
  "pages.startTest": "under Marketing, Landing pages, Who sees which page",
  "campaigns.approve":
    "on the campaign's own screen, under Marketing, Campaigns",
  "social.approve": "on the post's own screen, under Marketing, Social",
  "reviews.publish": "on the review's own screen, under Marketing, Reviews",
  // A review is a customer's own words. Typing one in is saying a customer
  // wrote it, and that is for somebody who has it in front of them.
  "reviews.add": "under Marketing, Reviews",
  "specials.switchOn": "under Marketing, Promo codes, Specials",
};

/**
 * What a bot has to hand over in so many words, where a person at a screen
 * may leave it to what was saved. The person saying yes is shown what the
 * bot handed over, so whatever would be sent has to be in it.
 */
export const BOT_MUST_SAY: Readonly<Record<string, readonly string[]>> = {
  // Without `body` a reply sends the saved draft, and a draft can be saved
  // again after the asking.
  "mail.send": ["body"],
};

/** What a bot may do with an operation it is offered. */
export type OfferedKind =
  /** It only reads. */
  | "look"
  /** It changes something inside the back end. */
  | "change"
  /** It sends, publishes or cannot be undone: a person says yes first. */
  | "ask"
  /** It is there, and a person does it on its own screen. Never a bot. */
  | "person";

export function kindOf(op: Op): OfferedKind {
  if (op.access === "read") return "look";
  if (op.name in PEOPLE_ONLY) return "person";
  return op.effect === "none" ? "change" : "ask";
}

/** Where a person does something a bot may not, said as part of a sentence. */
export const whereAPersonDoes = (op: Op): string =>
  PEOPLE_ONLY[op.name] ?? "in the back end";

/* ---- what was handed over, and what would be read of it ------------------- */

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The keys of what was handed over that the operation would not read.
 *
 * Reading an operation's input drops whatever it does not know, without a
 * word. For a person at a form that is harmless. For a bot it is not: a key
 * spelt nearly right is dropped and the operation runs on what is left, and
 * a request put in front of a person can carry a key that looks as though
 * it matters and does nothing (a `Body` beside no `body`). So what a bot
 * hands over is compared with what was read of it, and anything dropped on
 * the way is named and refused.
 *
 * `given` is what arrived and `read` is the same thing once the operation's
 * own schema has read it. Where the two stop being the same shape (a date
 * read from text, say) there is nothing left to compare and it stops.
 */
export function unreadKeys(given: unknown, read: unknown, at = ""): string[] {
  if (Array.isArray(given)) {
    if (!Array.isArray(read) || read.length !== given.length) return [];
    return given.flatMap((each, index) =>
      unreadKeys(each, read[index], `${at}[${String(index)}]`),
    );
  }
  if (!isPlain(given) || !isPlain(read)) return [];
  const unread: string[] = [];
  for (const [key, value] of Object.entries(given)) {
    const where = at === "" ? key : `${at}.${key}`;
    if (!Object.hasOwn(read, key)) unread.push(where);
    else unread.push(...unreadKeys(value, read[key], where));
  }
  return unread;
}

/** The operation by that name, if a bot may be offered it. */
export function offeredOp(name: string): Op | null {
  const op = ALL_OPS.get(name);
  if (op === undefined || SYSTEM_ONLY.has(name) || op.access === "admin") {
    return null;
  }
  return op;
}

/** Everything a bot may be offered, by name. */
export const OFFERED: readonly Op[] = [...ALL_OPS.values()]
  .filter((op) => offeredOp(op.name) !== null)
  .sort((a, b) => (a.name < b.name ? -1 : 1));

/* ---- finding one ---------------------------------------------------------- */

export type Found = {
  readonly name: string;
  readonly title: string;
  readonly kind: OfferedKind;
  /** The first sentence of what it does. */
  readonly summary: string;
};

/** "markShipped" as words: "mark shipped". */
const spaced = (name: string) =>
  name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[._]/g, " ")
    .toLowerCase();

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2);

/** A word as it is compared: "orders" and "order" are one word. */
const stem = (word: string) =>
  word.length > 4 ? word.replace(/(?:ing|ed|es|s)$/, "") : word;

const firstSentence = (text: string): string => {
  const end = text.search(/[.:](?:\s|$)/);
  const one = end === -1 ? text : text.slice(0, end + 1);
  return one.length > 220 ? `${one.slice(0, 217)}...` : one;
};

const found = (op: Op): Found => ({
  name: op.name,
  title: op.title,
  kind: kindOf(op),
  summary: firstSentence(op.description),
});

type Indexed = {
  readonly op: Op;
  readonly name: ReadonlySet<string>;
  readonly title: ReadonlySet<string>;
  readonly body: ReadonlySet<string>;
};

const INDEX: readonly Indexed[] = OFFERED.map((op) => ({
  op,
  name: new Set(wordsOf(spaced(op.name)).map(stem)),
  title: new Set(wordsOf(op.title).map(stem)),
  body: new Set(wordsOf(op.description).map(stem)),
}));

/** Words that say nothing about which operation is wanted. */
const EMPTY_WORDS: ReadonlySet<string> = new Set(
  [
    "the",
    "an",
    "of",
    "to",
    "for",
    "in",
    "on",
    "and",
    "or",
    "is",
    "it",
    "my",
    "me",
    "all",
    "how",
    "do",
    "what",
    "with",
    "from",
    "that",
    "this",
    "can",
    "be",
  ].map(stem),
);

/**
 * The operations that best match some words, best first. A name counts for
 * most, then a title, then what the description says.
 */
export function findOps(query: string, limit = 12): Found[] {
  const exact = offeredOp(query.trim());
  if (exact !== null) return [found(exact)];
  const asked = [...new Set(wordsOf(spaced(query)).map(stem))].filter(
    (word) => !EMPTY_WORDS.has(word),
  );
  if (asked.length === 0) return [];
  const scored = INDEX.map((entry) => {
    let score = 0;
    let hit = 0;
    for (const word of asked) {
      const inName = entry.name.has(word);
      const inTitle = entry.title.has(word);
      const inBody = entry.body.has(word);
      if (inName || inTitle || inBody) hit += 1;
      score += (inName ? 8 : 0) + (inTitle ? 5 : 0) + (inBody ? 1 : 0);
    }
    // An operation that speaks to every word asked beats one that speaks
    // loudly to one of them.
    return { entry, score: score + (hit === asked.length ? 10 : 0), hit };
  })
    .filter((each) => each.hit > 0)
    .sort(
      (a, b) =>
        b.score - a.score || (a.entry.op.name < b.entry.op.name ? -1 : 1),
    );
  return scored.slice(0, limit).map((each) => found(each.entry.op));
}

export type Area = {
  readonly area: string;
  readonly count: number;
  /** A few of what is in it, to show the kind of thing. */
  readonly some: readonly string[];
};

/** What there is, by area, for somebody who has not asked for anything yet. */
export function areas(): Area[] {
  const by = new Map<string, Op[]>();
  for (const op of OFFERED) {
    const area = op.name.split(".")[0] ?? "";
    by.set(area, [...(by.get(area) ?? []), op]);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([area, ops]) => ({
      area,
      count: ops.length,
      some: ops.slice(0, 4).map((op) => op.name),
    }));
}

/* ---- describing one ------------------------------------------------------- */

export type Described = Found & {
  /** Everything it says about itself: what it does and when to use it. */
  readonly description: string;
  /** What to hand it, as JSON Schema. */
  readonly input: Record<string, unknown>;
};

/** What an operation takes, as JSON Schema. Never thrown from. */
export function inputSchemaOf(op: Op): Record<string, unknown> {
  try {
    const { $schema: _dialect, ...schema } = z.toJSONSchema(op.input, {
      io: "input",
      unrepresentable: "any",
    }) as Record<string, unknown>;
    return schema;
  } catch {
    return { type: "object" };
  }
}

export function describeOp(op: Op): Described {
  return {
    ...found(op),
    description: op.description,
    input: inputSchemaOf(op),
  };
}
