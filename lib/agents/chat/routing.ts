/**
 * Working out which job she is asking for.
 *
 * She types "how much No 02 have we got". Somewhere between that sentence and
 * a run, something has to decide that this is a stock question and therefore
 * belongs to whoever advertises `stock_and_supply` — which today is Marlow,
 * though she will never be asked to know that. Capability first, agent second,
 * always: that is the whole point of `lib/agents/boundary/handoff.ts`, and a
 * chat that made her name an agent would have thrown it away on the first
 * screen.
 *
 * **This is a vocabulary, not a model.** A model call to decide where a message
 * goes would cost money before any work happened, would fail on a deployment
 * with no model configured, and — worst of the three — could not tell her WHY
 * it went where it went in words she can check. A phrase table can: the router
 * returns the words it matched, the surface shows them, and when it gets one
 * wrong she can see the reason and say it differently. It is also the part of
 * this unit most likely to want replacing later, which is why nothing else in
 * `lib/agents/chat` knows how the decision was made.
 *
 * Two honest failures, and they are different:
 *
 *  - **No capability matched.** Nobody in this company does that kind of work.
 *    "Book me a flight" is not a stock question phrased badly.
 *  - **A capability matched and nobody is advertising it.** Every capability is
 *    advertised by somebody in the roster as it stands, so this happens when the
 *    agent that holds it has been paused. That is a real and useful answer:
 *    paused means paused, including for work that arrives through chat.
 *
 * The second is `InProcessHandoff`'s `unroutable`. The first is this file's, and
 * both reach her as the same plain sentence with different words in it.
 */

import { CAPABILITIES, type Capability } from "../boundary/handoff";

/** What a capability is, said to somebody who does not work here. */
export const CAPABILITY_WORDS: Readonly<Record<Capability, string>> = {
  stock_and_supply: "how much is left, and what needs making or ordering",
  supplier_ordering: "putting an order in with a supplier",
  customer_reply: "answering somebody who has written in",
  pricing_and_margin: "what a bottle costs to make and what it should sell for",
  social_content: "writing a post",
  b2c_campaign: "an email to the customer list",
  wholesale_outreach: "the bars, restaurants and shops that stock us",
  product_development: "what the range should make next",
  business_reporting: "how the week went",
  security_watch:
    "who can get into this admin, and whether anything is exposed",
  catalogue_facts: "what is in the range and what it costs",
};

/**
 * One capability's vocabulary.
 *
 * `phrases` are what the job actually sounds like and are worth a match on
 * their own. `hints` are words that appear in half the sentences in a pickle
 * company and only count once something else has already matched — "batch" and
 * "bottle" are hints, "running low" is a phrase.
 */
interface Vocabulary {
  readonly capability: Capability;
  readonly phrases: readonly string[];
  readonly hints?: readonly string[];
}

/**
 * The table, in tie-break order.
 *
 * A message that scores equally for two capabilities goes to the one higher up
 * this list, and the list runs from the most specific ask to the most general.
 * "Put an order in with the dill supplier" scores for both supplier ordering
 * and stock; ordering is what she asked for.
 */
const VOCABULARIES: readonly Vocabulary[] = [
  {
    capability: "supplier_ordering",
    phrases: [
      "order from",
      "order some more",
      "put an order in",
      "place an order",
      "purchase order",
      "reorder",
      "re-order",
      "buy more",
      "supplier",
      "suppliers",
    ],
    hints: ["order", "buy"],
  },
  {
    // High in the table because these words mean one thing and nothing else in
    // a pickle company: nobody asks about "two-factor" or "locked out" meaning
    // stock. "password" and "hacked" are the two she is most likely to type.
    capability: "security_watch",
    phrases: [
      "security",
      "secure",
      "hacked",
      "hack",
      "breach",
      "breached",
      "password",
      "passwords",
      "locked out",
      "lockout",
      "signed in",
      "sign in",
      "logged in",
      "log in",
      "who can get in",
      "two factor",
      "two-factor",
      "2fa",
      "api key",
      "access token",
      "leaked",
      "phishing",
      "suspicious",
      "audit trail",
    ],
    hints: ["access", "token", "safe", "login", "admin"],
  },
  {
    capability: "wholesale_outreach",
    phrases: [
      "wholesale",
      "trade account",
      "trade accounts",
      "stockist",
      "stockists",
      "bottle shop",
      "bottle shops",
      "the bars",
      "restaurants",
      "venue",
      "venues",
      "gone quiet",
      "reorder cadence",
    ],
    hints: ["bar", "bars", "restaurant", "shops", "trade", "account"],
  },
  {
    capability: "b2c_campaign",
    phrases: [
      "campaign",
      "newsletter",
      "email the list",
      "email the customer",
      "mailing list",
      "customer list",
      "email everyone",
      "email out",
    ],
    hints: ["email", "list"],
  },
  {
    capability: "social_content",
    phrases: [
      "post",
      "posts",
      "instagram",
      "tiktok",
      "caption",
      "social",
      "the feed",
      "reel",
      "story for",
    ],
    hints: ["write", "content"],
  },
  {
    capability: "customer_reply",
    phrases: [
      "customer",
      "customers",
      "reply",
      "replies",
      "review",
      "reviews",
      "complaint",
      "complained",
      "unhappy",
      "waiting on us",
      "wrote in",
      "emailed us",
      "refund",
      "get back to",
    ],
    hints: ["waiting", "answer", "message"],
  },
  {
    capability: "pricing_and_margin",
    phrases: [
      "price",
      "prices",
      "pricing",
      "margin",
      "margins",
      "markup",
      "unit cost",
      "cost to make",
      "costs to make",
      "cost us",
      "costs us",
      "what does it cost",
      "gst",
      "too cheap",
      "too expensive",
      "put the price",
      "profit",
    ],
    hints: ["cost", "money", "charge"],
  },
  {
    capability: "product_development",
    phrases: [
      "new flavour",
      "new flavor",
      "next flavour",
      "new product",
      "what should we make",
      "product idea",
      "new brine",
      "new line",
      "worth making",
    ],
    hints: ["idea", "make", "next"],
  },
  {
    capability: "stock_and_supply",
    phrases: [
      "stock",
      "in stock",
      "how many",
      "how much",
      "have we got",
      "do we have",
      "run out",
      "running out",
      "running low",
      "low on",
      "days of cover",
      "on the shelf",
      "left",
      "inventory",
      "fermenter",
      "batch",
      "batches",
      "brewing",
      "bottle up",
    ],
    hints: ["bottles", "jars", "supply"],
  },
  {
    capability: "business_reporting",
    phrases: [
      "how did we do",
      "how are we doing",
      "how was the week",
      "last week",
      "this week",
      "last month",
      "the month so far",
      "briefing",
      "how is the business",
      "takings",
      "trading",
      "sales",
      "how did that go",
    ],
    hints: ["report", "summary", "numbers", "week"],
  },
  {
    capability: "catalogue_facts",
    phrases: [
      "the range",
      "catalogue",
      "catalog",
      "what do we sell",
      "what do we make",
      "which bottles",
      "line up",
      "lineup",
      "our products",
      "sku",
    ],
    hints: ["range", "product", "products", "bottle"],
  },
];

/** Every capability has a vocabulary; a new one without words is a routing hole. */
export const ROUTED_CAPABILITIES: readonly Capability[] = VOCABULARIES.map(
  (entry) => entry.capability,
);

/** The capabilities this file cannot route, which must always be none. */
export function unroutedCapabilities(): readonly Capability[] {
  return CAPABILITIES.filter(
    (capability) => !ROUTED_CAPABILITIES.includes(capability),
  );
}

/** Where a message was sent, and the words that sent it there. */
export interface Routing {
  readonly capability: Capability;
  /** The phrases that matched, in the order they appear in her message. */
  readonly matched: readonly string[];
  /** Everything else that scored, best first. For the record, not the screen. */
  readonly runnersUp: readonly Capability[];
}

/**
 * Fold a message down to the form the table is written against.
 *
 * Punctuation becomes a space rather than nothing, so "stock?" matches "stock"
 * and "re-order" survives as itself. Curly apostrophes are folded to straight
 * ones because a phone types the curly one and the table is typed on a
 * keyboard.
 */
export function normalise(message: string): string {
  return ` ${message
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/**
 * Does the normalised text contain this phrase as whole words?
 *
 * `normalise` pads the text with a space at each end, so a phrase surrounded by
 * spaces matches at the start and the end too, and "order" never matches inside
 * "reorder".
 */
function contains(haystack: string, phrase: string): boolean {
  return haystack.includes(` ${phrase} `);
}

/**
 * A longer phrase is a stronger signal than a shorter one.
 *
 * "How much" is two words and could start almost anything; "days of cover" is
 * three and can only be one thing. Scoring by word count means the table does
 * not need hand-tuned weights that nobody will keep true.
 */
function weightOf(phrase: string): number {
  return 2 + phrase.split(" ").length;
}

/**
 * Which job this is, or nothing.
 *
 * Nothing is a real answer and the caller must not turn it into a guess: a
 * message that matches no vocabulary is a message about work this company does
 * not do, and saying so is more use to her than sending it to whoever is
 * nearest.
 */
export function route(message: string): Routing | null {
  const text = normalise(message);
  if (text.trim() === "") return null;

  const scored: {
    capability: Capability;
    score: number;
    matched: string[];
  }[] = [];

  for (const vocabulary of VOCABULARIES) {
    const matched: string[] = [];
    let score = 0;
    for (const phrase of vocabulary.phrases) {
      if (contains(text, phrase)) {
        matched.push(phrase);
        score += weightOf(phrase);
      }
    }
    // Hints only count once the vocabulary has already earned a real match, so
    // a lone "bottle" never routes anything anywhere.
    if (score > 0) {
      for (const hint of vocabulary.hints ?? []) {
        if (contains(text, hint) && !matched.includes(hint)) {
          matched.push(hint);
          score += 1;
        }
      }
    }
    if (score > 0)
      scored.push({ capability: vocabulary.capability, score, matched });
  }

  if (scored.length === 0) return null;

  // Stable: `scored` is built in table order, so an equal score keeps the
  // more specific capability, which is what the table's order encodes.
  const ranked = [...scored].sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (best === undefined) return null;

  // Longest phrases first, so the reason she reads leads with the words that
  // actually decided it rather than with "how much".
  const matched = [...best.matched].sort(
    (left, right) => weightOf(right) - weightOf(left),
  );

  return {
    capability: best.capability,
    matched,
    runnersUp: ranked.slice(1).map((entry) => entry.capability),
  };
}

/**
 * Why this went where it went, for her.
 *
 * Names the words she used and the job they name. Never the agent — the agent
 * is shown beside the answer, because "Marlow answered because you said
 * 'running low'" is one sentence about two different things.
 */
export function routingReason(routing: Routing): string {
  const words = routing.matched
    .slice(0, 2)
    .map((phrase) => `“${phrase}”`)
    .join(" and ");
  return `You said ${words}, so this is about ${CAPABILITY_WORDS[routing.capability]}.`;
}

/** What the team can be asked for, for the message that says nobody does this. */
export function whatTheTeamDoes(
  advertised: readonly Capability[],
): readonly string[] {
  return CAPABILITIES.filter((capability) =>
    advertised.includes(capability),
  ).map((capability) => CAPABILITY_WORDS[capability]);
}
