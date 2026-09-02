/**
 * Go live — everything still standing between HALF SOUR and trading for real.
 *
 * **To mark a task done: set `done: true` on its entry below AND tick the same
 * item in the "Needs the founder" section of `TODO.md` — both, because
 * `tests/admin/go-live.test.ts` fails when the two disagree.**
 *
 * ## Why this is a file in the repository and not a table in the database
 *
 * The demonstration database is compiled into each build and rebuilt on every
 * deploy, so a checklist kept there would erase itself the next time anything
 * shipped. A file survives that. It also means a Claude Code session marks a
 * task done by editing a file — no credential, no API call, nothing to be
 * granted — and `git log content/go-live.ts` is then the honest record of when
 * each one actually got done.
 *
 * ## What every entry has to carry
 *
 * The founder is not technical and this is the only handover she has. So a task
 * is not "what to do": it is what it is, why it matters in words she would use,
 * what stays broken until it is done, what else is waiting on it, roughly how
 * long it takes, where to go, and the exact message she can paste into Claude
 * Code to make it happen. An entry missing any of those is a task she has to
 * come and ask about, which is the thing this page exists to stop.
 *
 * Order is priority, top to bottom. It is not the order they were thought of.
 */

/** Why a task cannot simply wait its turn. At most one per task. */
export type GoLiveUrgency = {
  /**
   * `law` — publishing it is already an offence.
   * `blocks` — nothing else really works until this is done.
   * `clock` — something changes on a date whether or not she acts.
   */
  readonly kind: "law" | "blocks" | "clock";
  /** The reason, in one sentence, shown beside the badge. */
  readonly text: string;
};

/** Where she has to go to do it. `href` is null when there is no one page. */
export type GoLivePlace = {
  readonly label: string;
  readonly href: string | null;
};

export type GoLiveTask = {
  /** Stable id. Used in the anchor and in the message that marks it done. */
  readonly id: string;
  /** Matches the bold heading of the same item in TODO.md, exactly. */
  readonly title: string;
  /** What the thing is, in one line. */
  readonly what: string;
  /** Why it matters, in her words rather than an engineer's. */
  readonly why: string;
  /** What breaks, or stays broken, until it is done. */
  readonly until: string;
  /** What else is waiting on it. Empty when nothing is. */
  readonly waiting: readonly string[];
  /** Roughly how long, honestly — including the waiting-on-someone-else part. */
  readonly howLong: string;
  readonly place: GoLivePlace | null;
  readonly urgency: GoLiveUrgency | null;
  /** The exact text she pastes into Claude Code. Written to her, as her. */
  readonly prompt: string;
  readonly done: boolean;
};

export const GO_LIVE_TASKS: readonly GoLiveTask[] = [
  {
    // copy-audit-approved: WILD-02 (kawakawa named as an ingredient and as the subject of a correction — no wellness and no rongoā framing anywhere in this entry)
    id: "kawakawa-claim",
    // copy-audit-approved: WILD-02 (as above — this entry exists to get an unverified origin line taken down, not to make one)
    title: "Verify the kawakawa supplier",
    // copy-audit-approved: WILD-02, PROV-04 (Tairāwhiti is named as the place that must come OUT of the live Shopify description; no origin is claimed for any batch here — legal/COPY-RULES.md Group G, live issue flagged 2026-08-27)
    what: "No 04 WILD's description in Shopify names a kawakawa grower in Tairāwhiti. Nobody there grows leaf for you.",
    why: "It is published right now, to anyone who opens the product page. Saying where food comes from when it does not come from there is an offence under the Fair Trading Act 1986, section 13(j). It is the only thing on this list that a regulator could act on today, and it is also the cheapest to fix — the sentence just has to go.",
    until:
      "Every hour the page stays up is another hour the claim is published. Nothing else on this list carries that.",
    waiting: [],
    howLong:
      "Ten minutes to take the paragraph out. Months to make it true instead, which is a fine thing to do later.",
    place: {
      label: "Shopify admin, then Products, then No 04 WILD, then Description",
      href: "https://admin.shopify.com/store/sgu8sy-at/products",
    },
    urgency: {
      kind: "law",
      text: "Published to customers now, and against the Fair Trading Act while it is.",
    },
    prompt: [
      // copy-audit-approved: WILD-02 (ingredient name, inside an instruction to delete an origin claim)
      "The live Shopify description for No 04 WILD (handle no-04-wild) has a paragraph naming where the kawakawa leaf comes from. That relationship does not exist, so the paragraph is a false place-of-origin claim under Fair Trading Act s 13(j) and it is public right now.",
      "",
      "Take it out. Replace it with nothing, or with a line saying the leaf is what limits how much can be made, which is true. Do not name a region, a place, a farm or anybody who picks it.",
      "",
      "Then check everywhere else the same claim could be sitting — the other product descriptions, the labels, the recipe pages, the captions — and run node legal/scripts/audit-copy.mjs app components content to be sure. Show me exactly what you took out and where.",
      "",
      // copy-audit-approved: WILD-02 (the entry id, so a session knows which line to change)
      "When it is done, mark it done: set done: true on the kawakawa-claim entry in content/go-live.ts and tick its box in TODO.md.",
    ].join("\n"),
    done: false,
  },
  {
    id: "shopify-tokens",
    title: "Shopify API tokens",
    what: "Two keys that let the website talk to your actual shop.",
    why: "Without them the site cannot take a single dollar. Everything you see in this admin right now — the orders, the stock, the takings — is a practice copy of your shop, not your shop. These two keys are what turns a demonstration into a business, and nobody but you can make them: Shopify refuses to let an AI tool create them, on purpose.",
    until:
      "No customer can buy anything. Every screen in here keeps showing practice data.",
    waiting: [
      "Orders, so that a real one appears when someone buys",
      "Stock counts that match what is on the shelf",
      "Anything that emails a customer about their order",
    ],
    howLong: "About twenty minutes in Shopify, five more in Vercel.",
    place: {
      label:
        "Shopify admin, then Settings, then Apps and sales channels, then Develop apps",
      href: "https://admin.shopify.com/store/sgu8sy-at/settings/apps/development",
    },
    urgency: {
      kind: "blocks",
      text: "No money can be taken until this is done. It holds up more than anything else here.",
    },
    prompt: [
      "Walk me through creating the Shopify API tokens, one screen at a time, and wait for me at each step. I am signed in to the Shopify admin.",
      "",
      "Tell me what to name the app, then read me the exact Storefront API scopes and the exact Admin API scopes to tick — they are written down in .claude/god-of-war/runs/20260827-121931/decisions.md, use that list and do not improvise it.",
      "",
      "When I have both tokens, tell me where in the Vercel project to paste them (SHOPIFY_STOREFRONT_ACCESS_TOKEN and SHOPIFY_ADMIN_ACCESS_TOKEN), and remind me which of the two must never be visible to a browser. Do not ask me to paste either token into this chat.",
      "",
      "Then set COMMERCE_PROVIDER=shopify, run the commerce conformance suite against the real shop, and tell me plainly whether it passed and what is now different.",
      "",
      "When it is done, mark it done: set done: true on the shopify-tokens entry in content/go-live.ts and tick its box in TODO.md.",
    ].join("\n"),
    done: false,
  },
  {
    id: "vercel-production-branch",
    title: "Point the live site at the finished build",
    what: "Vercel is still publishing an old working branch, so half-sour.vercel.app shows the scaffold instead of the site.",
    why: "The homepage is built, it is green, and it is sitting on main where nobody can see it. One setting in Vercel is the entire distance between that and the site being live. It is one of two things here that an AI cannot do for you, because neither Vercel key in this project is valid any more.",
    until:
      "Everything the site has gained — the homepage, the shop, the four product pages — stays invisible to anyone who types the address.",
    waiting: ["Anything at all that a customer is meant to look at"],
    howLong: "Two minutes, then a redeploy that takes a few more.",
    place: {
      label:
        "Vercel, then the half-sour project, then Settings, then Environments, then Production, then Branch Tracking",
      href: "https://vercel.com/dashboard",
    },
    urgency: {
      kind: "blocks",
      text: "The public address serves the wrong build until this is changed.",
    },
    prompt: [
      "Vercel's production branch tracking for the half-sour project still points at claude/pickle-juice-brand-site-qu6jrr, and it should point at main. I am signed in to Vercel and you are not, so tell me the exact clicks and wait for me.",
      "",
      "Once it is switched, have me redeploy main from the dashboard, then check half-sour.vercel.app yourself and confirm it is serving the real homepage rather than the scaffold.",
      "",
      "Then take the paragraph about pushing to two branches out of CLAUDE.md and out of TODO.md, because it stops being true the moment this is done.",
      "",
      "When it is done, mark it done: set done: true on the vercel-production-branch entry in content/go-live.ts and tick its box in TODO.md.",
    ].join("\n"),
    done: true,
  },
  {
    id: "admin-password",
    title: "Change the admin password",
    what: "The password on this admin is a demonstration password.",
    why: "It follows the most guessable pattern a person can pick — a word, a year and a punctuation mark. It is the only thing between the internet and your orders, your customers and your money. Everything else on this list can wait a week without harm. This one should not.",
    until:
      "Anyone who guesses one obvious password can read the whole business.",
    waiting: ["Opening the admin to anyone outside the build"],
    howLong: "Five minutes.",
    place: {
      label:
        "In the repository: npm run auth:hash-password, then the Vercel project settings",
      href: null,
    },
    urgency: {
      kind: "blocks",
      text: "This stays a demonstration, not a shop, until the password is yours.",
    },
    prompt: [
      "Help me change the admin password. Run npm run auth:hash-password so I can type a new password into it myself — do not suggest one for me, and do not ask me to type it into this chat.",
      "",
      "Then tell me exactly where to paste the resulting hash in the Vercel project as ADMIN_PASSWORD_HASH, and whether anything else has to be set alongside it. After it is deployed, check with me that the old password no longer opens /login and the new one does.",
      "",
      "Tell me too whether any existing sign-in stays valid after the change, and how I would end them all if I wanted to.",
      "",
      "When it is done, mark it done: set done: true on the admin-password entry in content/go-live.ts and tick its box in TODO.md.",
    ].join("\n"),
    done: false,
  },
  {
    id: "delivery-rates",
    title: "Delivery rates confirmed with a courier",
    what: "What it really costs to send one bottle and to send three, agreed with a courier and written into the site.",
    why: "The delivery page, the terms and the checkout all quote a postage price that the build invented. Quoting a number you have not agreed with anyone is a mistake that costs twice — once in the postage you did not charge for, and once when a customer is charged something different from what the page said.",
    until:
      "legal/shipping-returns.md still reads [$X] where three prices and a threshold should be, and the site keeps showing an invented rate.",
    waiting: [
      "Being able to answer what postage costs without guessing",
      "Sending anything to a rural address with confidence",
    ],
    howLong: "An hour of your time, mostly spent waiting on a quote.",
    place: {
      label:
        "Your courier's business rates — NZ Post, or whoever picks up from you",
      href: "https://www.nzpost.co.nz/",
    },
    urgency: null,
    prompt: [
      "I have courier rates now. Here they are: standard, rural, overnight, and the order value above which I want to stop charging postage at all.",
      "",
      "Put them into legal/shipping-returns.md where the [$X] entries are, and into the settings this site reads for postage, so that the delivery page, the terms page and the checkout all quote the same number as each other.",
      "",
      "Then show me the three places a customer sees a delivery price, and confirm to me that they agree. Run node legal/scripts/audit-copy.mjs app components content afterwards, because how a postage offer is worded is regulated too.",
      "",
      "When it is done, mark it done: set done: true on the delivery-rates entry in content/go-live.ts and tick its box in TODO.md.",
    ].join("\n"),
    done: false,
  },
  {
    id: "company-details",
    title: "The legal entity, NZBN and address",
    what: "Who is actually selling, written down where a customer can read it.",
    why: "A terms page that cannot say which company is behind the sale is a page a customer cannot rely on, and an invoice with no NZBN on it is one a bar or a shop will send straight back. The part of the terms that is settled is published; the part that names you is blank, and it stays blank until you fill it in.",
    until:
      "legal/terms-of-sale.md keeps its gaps and /terms publishes only the half that is settled.",
    waiting: ["Invoicing a bar or a shop", "The full terms of sale going up"],
    howLong:
      "Ten minutes if the company already exists. A day or two if it does not.",
    place: {
      label: "The New Zealand Business Number register",
      href: "https://www.nzbn.govt.nz/",
    },
    urgency: null,
    prompt: [
      "Here are the company details: registered company name, NZBN, registered address, and GST number.",
      "",
      "Put them into legal/terms-of-sale.md where the gaps are, into the company settings this admin reads, and into anything on the site that has been leaving them out. Then show me /terms and the footer with the real details in them, and tell me if anything else on the site should be naming the company and is not.",
      "",
      "When it is done, mark it done: set done: true on the company-details entry in content/go-live.ts and tick its box in TODO.md.",
    ].join("\n"),
    done: false,
  },
  {
    id: "accounts-in-your-name",
    title: "Your own Vercel, GitHub and Shopify accounts",
    what: "The three accounts this business runs on, each one signed in to by you.",
    why: "The site is deployed from a Vercel account, the code lives in a GitHub account, and the shop is a Shopify account. If any of the three is not yours, or is one you cannot sign into without asking somebody, then there is a day where you cannot get to your own business. Sort it while it is a five minute job rather than a crisis.",
    until:
      "There is at least one door to this business that you cannot open on your own.",
    waiting: ["Being able to hand any of this to anyone else, ever"],
    howLong: "Half an hour, plus however long an invitation takes to arrive.",
    place: {
      label:
        "Vercel, GitHub and Shopify — check the owner and the billing on each",
      href: "https://vercel.com/account",
    },
    urgency: null,
    prompt: [
      "Go through the three accounts this business depends on — Vercel, GitHub and Shopify — and tell me for each one who owns it, who is being billed, and whether I can sign in myself without asking anybody.",
      "",
      "Where the answer is no, tell me exactly what to click to move it into my name or to add me as an owner, and what could break while it moves.",
      "",
      "Then write me a short list of every account, login and payment card this business now runs on, so that there is one place that says it.",
      "",
      "When it is done, mark it done: set done: true on the accounts-in-your-name entry in content/go-live.ts and tick its box in TODO.md.",
    ].join("\n"),
    done: false,
  },
  {
    id: "domain",
    title: "A domain of your own",
    what: "halfsour.co.nz and halfsour.nz were both unregistered when they were last checked. halfsour.com is taken and parked.",
    why: "half-sour.vercel.app is fine for showing people the site. It is not a name you print on a label, hand across a bar, or say out loud to someone. Buying it is also how you stop somebody else buying it first, which happens to small brands more often than it should.",
    until:
      "Every label, card and caption has to carry a Vercel address, or carry no address at all.",
    waiting: [
      "Labels and cards, and anything else that goes to a printer",
      "Email at your own name rather than a free one",
    ],
    howLong: "Twenty minutes, and it costs very little a year.",
    place: {
      label: "Any New Zealand registrar — the .nz register lists them",
      href: "https://www.dnc.org.nz/",
    },
    urgency: null,
    prompt: [
      "Check whether halfsour.co.nz and halfsour.nz are still unregistered, and tell me what registering one costs and which registrars are worth using in New Zealand.",
      "",
      "Once I have registered it, walk me through pointing it at the Vercel project and moving the site onto it, and tell me what has to change in the code or the settings when the address changes.",
      "",
      "When it is done, mark it done: set done: true on the domain entry in content/go-live.ts and tick its box in TODO.md.",
    ].join("\n"),
    done: false,
  },
  {
    id: "trademark",
    title: "Trademark filing",
    what: "HALF SOUR registered as a trade mark in New Zealand, in class 32.",
    why: "The name looked clear when it was searched on 27 August 2026. Clear is not registered. The way a small brand loses its name is by building on it for two years and then meeting somebody who filed first, and the cost of that is everything printed to date.",
    until: "Nothing breaks. The risk just sits there getting more expensive.",
    waiting: [],
    howLong:
      "An hour to file. Months for it to be examined, which is why starting matters more than finishing.",
    place: {
      label: "IPONZ, the Intellectual Property Office of New Zealand",
      href: "https://www.iponz.govt.nz/",
    },
    urgency: null,
    prompt: [
      "Walk me through filing HALF SOUR as a trade mark with IPONZ. Two things came out of the clearance search and both have to be respected: file the composite mark — the drawn wordmark together with its device, which is in brand/assets — rather than the plain words, because half sour is the category term and the plain words would likely fail on distinctiveness; and file class 32 first, because class 33 already contains SOURZ.",
      "",
      "Prepare the image at whatever size IPONZ wants, list everything I have to fill in myself, and tell me what it costs before I start.",
      "",
      "When it is done, mark it done: set done: true on the trademark entry in content/go-live.ts and tick its box in TODO.md.",
    ].join("\n"),
    done: false,
  },
  {
    id: "social-accounts",
    title: "The Instagram and TikTok accounts",
    what: "The accounts themselves, in the brand's name and held by you.",
    why: "The names are available until somebody else takes them, and the Social screen in this admin is a plan with nowhere to send anything until they exist. Taking the names costs nothing and takes twenty minutes; getting them back later costs a rename.",
    until: "Nothing drafted for Social can be posted anywhere.",
    waiting: ["Everything on the Social screen"],
    howLong: "Twenty minutes.",
    place: {
      label: "Instagram and TikTok, signed up in the business's name",
      href: null,
    },
    urgency: null,
    prompt: [
      "Help me set up the Instagram and TikTok accounts for HALF SOUR. Tell me what to check before I take a handle, what to put in the two profiles so they match the brand rather than contradicting it, and what to avoid saying in a profile given the rules in legal/COPY-RULES.md.",
      "",
      "Then tell me what this admin needs from me to be able to post to them, and what stays manual for now.",
      "",
      "When it is done, mark it done: set done: true on the social-accounts entry in content/go-live.ts and tick its box in TODO.md.",
    ].join("\n"),
    done: false,
  },
  {
    id: "product-photography",
    title: "Real product photography",
    what: "Photographs of the actual bottles, on an actual surface.",
    why: "Every picture on the site today is drawn. The drawing is honest and it is a great deal better than an AI photograph with garbled label text, but somebody deciding whether to spend $26 on a bottle they have never tasted wants to see the bottle. This is the one thing on the list that only a camera can finish.",
    until:
      "The site keeps selling with illustrations where a photograph should be.",
    waiting: ["Anything printed, and anything posted"],
    howLong:
      "Half a day with a camera and a window, or a booking with somebody who does it for a living.",
    place: null,
    urgency: null,
    prompt: [
      "I have product photographs now, in this folder. Bring them into the repository at the sizes the site needs, put them in place of the drawn artwork on the homepage, the shop and the four product pages, and write the alt text for each one so a person using a screen reader gets the same information.",
      "",
      "Then check that the performance budget still passes and that nothing on the page got slower, and show me before and after at both phone and desktop width.",
      "",
      "When it is done, mark it done: set done: true on the product-photography entry in content/go-live.ts and tick its box in TODO.md.",
    ].join("\n"),
    done: false,
  },
];

/** How far through the list she is. */
export type GoLiveProgress = {
  readonly total: number;
  readonly done: number;
  readonly remaining: readonly GoLiveTask[];
  readonly finished: readonly GoLiveTask[];
  /** The one to do next, or null when there is nothing left. */
  readonly next: GoLiveTask | null;
};

export function goLiveProgress(
  tasks: readonly GoLiveTask[] = GO_LIVE_TASKS,
): GoLiveProgress {
  const remaining = tasks.filter((task) => !task.done);
  const finished = tasks.filter((task) => task.done);
  return {
    total: tasks.length,
    done: finished.length,
    remaining,
    finished,
    next: remaining[0] ?? null,
  };
}
