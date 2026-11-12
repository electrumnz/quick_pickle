/**
 * The Quick Pickle brand guide, as this build follows it.
 *
 * Ashleigh's files are the brand: the logo, Lucky, the three colours, the four
 * fonts and her own lines. "Brand Guide v2" was Grok's first write-up of those
 * files. This is the working version: the same foundations, tightened where
 * building and testing the real site showed something better, and with the
 * one legal problem in the original designed out rather than flagged.
 *
 * It is shown at /backstage/brand, rendered with the site's own tokens, fonts
 * and components, so what the guide says and what the site does cannot drift.
 *
 * On 12 November 2026 Grok added a strategy proposal, a tone-of-voice proposal
 * and a list of thirty questions for Ashleigh to the shared Drive. They are
 * drafts waiting on her. What this guide takes from them, and where it goes
 * its own way, is set out in SOURCES at the bottom.
 *
 * This file is on the scanner's internal surface: it is never shown to a
 * customer. It has to quote the lines we never publish in order to rule them
 * out, and those quotes sit between ignore markers.
 */

export const IDEA = {
  line: "A little shot of good luck.",
  summary:
    // copy-audit-ignore: says what the brand is NOT.
    "Quick Pickle is a ritual, not a remedy. Everyone who plays has a thing they do before they go out there: left boot first, same socks since the semi, three bounces before the serve. Ours is a shot of pickle juice, and Lucky is the charm that comes with it.",
  why: [
    "It is what Ashleigh wrote. Her Meet Lucky page opens with rituals and lucky charms; this keeps that and drops only the sentence the law will not let a food say.",
    "It is ownable. Every other pickle juice sells the same promise in the same words. Nobody else has a superhero cat and a superstition.",
    "It is safe to say out loud. A lucky charm is, by definition, not a claim about your body.",
  ],
  audience:
    "People with a game-day ritual: club players, weekend runners, social-grade netballers, the parent running the sideline. Not elite sport, and never anyone's medical needs.",
} as const;

export const PILLARS = [
  {
    name: "The taste",
    say: "Sour, salty, properly pickly. Everyone pulls the face.",
  },
  {
    name: "The tiny bottle",
    say: "A 100 ml bottle. One twist, down in one, done. Lives in the kit bag.",
  },
  {
    name: "The ritual",
    say: "Before the whistle, at the half, on the sideline with the oranges.",
  },
  {
    name: "Lucky",
    say: "Part cat, all cape. The charm that comes with every shot.",
  },
] as const;

export const VOICE = {
  summary:
    "Warm, encouraging, a little cheeky, always on the player's side. It sounds like the funniest person on the sideline, not a sports-science brand.",
  dos: [
    "Short sentences. Second person.",
    "Sideline language: the whistle, the sheds, the kit bag, the half-time oranges.",
    "One pun at a time, and only when it is a good one.",
    "Say when people have one. Never say why.",
    "Lucky is a helper with a personality, not a logo with legs.",
  ],
  donts: [
    "Nothing about what it does to a body. Not even as a joke or a wink.",
    "No invented facts: ingredients, origin, reviews, numbers.",
    "No sports-science words. If it sounds like a supplement label, start again.",
    "No shouting. The type is loud so the words do not have to be.",
    "No new slogan inside the official logo.",
  ],
  official: [
    "Never fear, Lucky is here.",
    "Lucky you've got us.",
    "Tiny package, big dill.",
    "Pickle Crew.",
  ],
  /** Hers, cut down. Not a quote, and never shown as one. */
  adapted: [
    {
      line: "A little shot of good luck.",
      from: "Our little shot of good luck for the quads,",
      note: "Her sentence runs straight on into the one we can never publish. The site keeps her best six words and stops there.",
    },
  ],
  ours: [
    "Clear as a whistle.",
    "Move over, oranges.",
    "No pickles. No bits. Just the juice.",
    "Everyone's got a thing. This is ours.",
    "Down in one. Pull the face. Go play.",
    "Made to hand round.",
    "Turning up. Every game.",
  ],
  vocabulary: [
    { use: "the jar", for: "the cart" },
    { use: "in the jar!", for: "added to cart" },
    { use: "a shot", for: "one bottle" },
    { use: "the Pickle Crew", for: "the mailing list and the customers" },
    { use: "The Trial, The Starter, The Squad", for: "the 6, 12 and 24 packs" },
  ],
} as const;

/* copy-audit-ignore-start: the brand guide quotes these lines in order to rule them out. */
export const NEVER = {
  intro:
    "These are in the original concept deck and they do not go on the site, the pack, an ad or a caption in New Zealand. A food may not be advertised as easing a condition, and may not claim an effect on physical or mental performance without approvals this product does not have. The scanner fails the build on every one of them.",
  lines: [
    {
      line: "delivering a pickle punch to cramps in 60 seconds flat",
      status: "Never",
      why: "Names a condition and promises to ease it. No evidence unlocks this for a food.",
    },
    {
      line: "mental strength is no match for the physical barriers that stop us in our tracks",
      status: "Never",
      why: "The set-up for the claim: it frames the product as the fix for a body letting you down.",
    },
    {
      line: "so your physical game can keep up with your mental one",
      status: "Never",
      why: "A physical-performance claim.",
    },
    {
      line: "Performance with pickles",
      status: "Held back",
      why: "Next to a food it reads as a performance claim. Needs advice and a recorded decision before it is used anywhere public.",
    },
    {
      line: "good luck for the quads",
      status: "Held back",
      why: "Naming a muscle implies the product does something for it. The site uses the line without the last three words.",
    },
    {
      line: "the pickle punch",
      status: "Never",
      why: "The front half of the banned sentence. On its own it still points at the back half. Lucky's special move is turning up.",
    },
    {
      line: "Superhero Cat with Pickle Power",
      status: "Held back",
      why: "His full title in the mascot file. Power next to a food can read as a claim. He is Lucky, the superhero cat, until there is advice on it.",
    },
  ],
  alsoAvoid:
    "Recovery, hydration, electrolytes, endurance, energy, athlete, workout, muscle. And any wink at them: saying we are not allowed to tell you what it does is itself a claim.",
} as const;
/* copy-audit-ignore-end */

/* copy-audit-ignore-start: the checks and word lists quote what we refuse in order to refuse it. */
/**
 * Six checks, asked of anything before it goes out: a page, a post, a label,
 * an email. Yes or no to each. Two noes and it goes back.
 *
 * The names are from Grok's strategy proposal (12 November 2026) and are kept
 * so everyone uses the same six words. The examples are ours.
 */
export const CHECKS = [
  {
    name: "Lucky leads",
    ask: "Is Lucky in it, or speaking for it, and doing something?",
    yes: "Lucky running flat out across the top of the page, pickle up, cape whole.",
    no: "Lucky shrunk to a corner badge. His cape, tail or pickle cropped off.",
  },
  {
    name: "Ritual, not remedy",
    ask: "Is it about the moment before the game, and never about a body?",
    yes: "Socks on. Playlist on. Lucky's here.",
    no: "Anything it stops, eases, boosts or speeds up. Any number of seconds.",
  },
  {
    name: "One punch per line",
    ask: "One idea, and at most one pun?",
    yes: "Tiny package, big dill. Then stop.",
    no: "Dill, brine and jar jokes stacked in one line, or a second gag in the line underneath.",
  },
  {
    name: "Loud letters, calm words",
    ask: "Is the type doing the shouting, so the words do not have to?",
    yes: "A headline in Summer Varsity, one calm sentence under it, a DIN label on the button.",
    no: "Sentences in capitals. Exclamation marks to add energy. More than three type styles on one screen.",
  },
  {
    name: "Flat, bold, outlined",
    ask: "Thick navy outline, flat colour, hard offsets?",
    yes: "Navy, cream, hot pink and olive in the jobs this guide gives them.",
    no: "Gradients, soft shadows, glows, a photo behind the logo, lab-white layouts.",
  },
  {
    name: "On the player's side",
    ask: "Cheeky with the player, never at their expense?",
    yes: "Same socks as last week? Respect.",
    no: "Jokes about anyone's body, size, skill or result. Talking down.",
  },
] as const;

/** How the names are written. */
export const NAMES = [
  {
    name: "Quick Pickle",
    always: "Two words, capital Q and P. Quick Pickle's.",
    never:
      "QuickPickle, Quick-Pickle, quick pickle, the Quick Pickle, QP in a sentence.",
  },
  {
    name: "QUICK PICKLE",
    always:
      "Capitals only when set in one of the varsity faces or a DIN label.",
    never: "Capitals in a Poppins sentence.",
  },
  {
    name: "QP",
    always: "The badge on Lucky's chest, and the front of an order number.",
    never: "Grab a QP.",
  },
  {
    name: "Lucky",
    always:
      "Capital L. He, him. Lucky, the superhero cat, the first time; Lucky after that.",
    never: "It. The mascot. Lucky the cat. A second Lucky.",
  },
  {
    name: "Pickle Crew",
    always: "Two words, both capitals. It means people.",
    never: "Pickle crew, PickleCrew, a product called Pickle Crew.",
  },
  {
    name: "Pickled Jews",
    always:
      "The umbrella name the project sits under. Nowhere a customer can see until Ashleigh says whether it shows, and in what words.",
    never: "Shortened, punned on, or put inside the logo.",
  },
  {
    name: "lucky",
    always:
      "Small l is the ordinary word. Her line Lucky you've got us uses the capital on purpose so it reads both ways.",
    never: "Fixing her capital.",
  },
] as const;

/** Reach for the left column. The right column is why the scanner exists. */
export const WORDS = {
  use: [
    "ritual, routine, lucky, charm",
    "game day, the whistle, the half, the sideline, the sheds",
    "kit bag, boots, socks, strapping tape, the oranges",
    "team, crew, the side, hand one round, shout the team",
    "shot, little, tiny, down in one, the face",
    "sour, salty, clear, dill, pickle, jar",
    "cape, superhero, turns up, here",
  ],
  refuse: [
    {
      words: "cramp, relief, stop, prevent, ease",
      why: "Names or hints at a condition. Never, for a food.",
    },
    {
      words: "hydrate, electrolytes, sodium as a benefit, minerals",
      why: "Nutrition and health claims need approvals this product does not have.",
    },
    {
      words: "recovery, hangover, gut, immune, antioxidant, detox",
      why: "Health claims.",
    },
    {
      words: "healthy, good for you, clean, natural goodness, superfood",
      why: "Implied health claims.",
    },
    {
      words: "clinically, proven, science-backed, formula, works in",
      why: "Lab talk, and unproven.",
    },
    {
      words: "boost, fuel, power up, energise, performance as a result",
      why: "Says it does something to a body.",
    },
    {
      words:
        "secret weapon, game changer, elite, trusted by the best, knockout",
      why: "Not a legal problem. Every other pickle shot already says it, and we are not them.",
    },
    {
      words: "guaranteed, best, number one, world's first",
      why: "Cannot be backed up.",
    },
  ],
} as const;
/* copy-audit-ignore-end */

/** The voice never changes. How loud it is does. */
export const TONE = [
  {
    place: "Hero, section titles, stickers",
    cheek: "Most",
    rule: "Three to seven words. One pun at most. Lucky up front.",
  },
  {
    place: "Section sentences, pack blurbs",
    cheek: "Some",
    rule: "Short, second person, sideline words. Calm.",
  },
  {
    place: "Buttons, prices, labels",
    cheek: "None",
    rule: "A verb or a fact. Pre-order. Add to jar. No puns on a price.",
  },
  {
    place: "Checkout, errors, order emails",
    cheek: "None, then a little",
    rule: "Say what happened and what to do next first. Lucky only signs off good news.",
  },
  {
    place: "Replies to customers",
    cheek: "None",
    // copy-audit-ignore: an instruction to staff on what NOT to engage with.
    rule: "Plain sentences, fix it first. If someone mentions their health, good or bad, do not agree or disagree: thank them, say we cannot give health advice, and pass it on.",
  },
  {
    place: "Fine print, delivery, returns, privacy",
    cheek: "None",
    rule: "No voice, no Lucky, no adjectives. As plain as it can be said.",
  },
] as const;

export const LOGO = {
  rules: [
    "The primary mark is Ashleigh's arched QUICK PICKLE with Lucky running through it. On navy, cream or white.",
    "On a pink ground use her stacked knockout lockup (navy letters, cream offset). The pink offset and cape of the primary mark disappear on pink.",
    "The header uses the name set in Varsity Senior, cream on navy with a hard pink offset. It is type, not a redrawn logo.",
    "Clear space is a tenth of the mark's height on every side. Minimum 120px wide on screen for the full lockup.",
    "Never redraw, re-letter, recolour, stretch, tilt or add a slogan to it. Never put it on a photograph or a busy pattern.",
  ],
} as const;

export const MASCOT = {
  rules: [
    "Lucky is the only cat. No sidekick, no second mascot.",
    "Cream tabby, navy stripes, pink cape, cream chest badge with olive QP, olive pickle. None of that changes.",
    "Use Ashleigh's own drawings first. Her vector pages are used as vector, so he is sharp at any size.",
    "Only the marks she drew as motion may move: burst lines, speed lines, the dust puff. His body is never animated or redrawn.",
    "Give him room. Never crop through the pickle, the cape or the tail.",
  ],
  official: [
    {
      art: "lucky-run",
      label: "Running. Vector, concept page 2.",
      kind: "vector",
    },
    {
      art: "lucky-up",
      label: "Flying up. Vector, concept page 1.",
      kind: "vector",
    },
    {
      art: "lucky-flying",
      label: "Running, full colour. The mascot file.",
      kind: "raster",
    },
    {
      art: "sticker-sunglasses",
      label: "Sunglasses. Sticker sheet.",
      kind: "raster",
    },
    { art: "sticker-hug", label: "Pickle hug. Sticker sheet.", kind: "raster" },
    {
      art: "sticker-face",
      label: "Face close-up. Sticker sheet.",
      kind: "raster",
    },
  ],
  proposed: [
    {
      art: "lucky-celebrate",
      label: "Celebrating. In use: order placed.",
      inUse: true,
    },
    {
      art: "lucky-sleeping",
      label: "Asleep on a jar. In use: empty jar, 404.",
      inUse: true,
    },
    { art: "lucky-thumbs-up", label: "Thumbs up. Not in use.", inUse: false },
    { art: "lucky-pointing", label: "Pointing. Not in use.", inUse: false },
    { art: "lucky-wink", label: "Salute. Not in use.", inUse: false },
    { art: "lucky-jar-lift", label: "Jar lift. Not in use.", inUse: false },
  ],
  proposedNote:
    "These were generated from her art, not drawn by her. Two are on the site in small supporting roles and are waiting on her nod. If she says no, they come out in one line each.",
} as const;

export const COLOUR_RULES = [
  "Navy does the work: outlines, text, buttons, the dark sections.",
  "Hot pink is the poster colour. It takes the hero and the big moments, and it is the offset under a navy button.",
  "On pink, only large type. Sentences go on a cream card. That rule is why the pink sections look the way they do.",
  "Olive is a highlight and a surface. Never small olive text on a light ground.",
  "Cream is the page. Paper is a card sitting on it.",
  "Offsets are a hard shift, never a blur. No drop shadows, no gradients, no glows.",
  "Pink deep and olive deep exist only so small text can pass contrast. They are not brand colours.",
] as const;

export const TYPE = [
  {
    token: "display",
    family: "Summer Varsity",
    role: "The big moments. Hero and section showpieces, set as wide as the screen.",
    sample: "A little shot of good luck.",
    rule: "ALL CAPS. Two or three short lines. Never under 48px.",
  },
  {
    token: "varsity",
    family: "Varsity Senior",
    role: "Section titles, pack names, the wordmark.",
    sample: "Pick your pack.",
    rule: "ALL CAPS. Carries the punctuation Summer Varsity lacks.",
  },
  {
    token: "label",
    family: "DIN Condensed Bold",
    role: "Buttons, prices, labels, tags, the ticker.",
    sample: "Pre-order · $48",
    rule: "ALL CAPS, tracked out a little. The only face allowed small on pink, and then only at 19px or more.",
  },
  {
    token: "sans",
    family: "Poppins Medium",
    role: "Sentences. The only mixed-case face.",
    sample: "Everyone's got a game-day ritual. Ours comes in a tiny bottle.",
    rule: "17px on a phone, 1.6 line height. SemiBold for emphasis.",
  },
] as const;

export const MOTION = {
  summary:
    "Like the cat landing: quick, punchy, then still. Motion marks a moment; it never decorates.",
  rules: [
    "Transform and opacity only. Nothing that makes the page reflow.",
    "A press shows inside 100ms. Buttons drop on to their offset.",
    "The signature is the burst: pink lines popping off the button when something lands in the jar, the same marks that fly off Lucky's pickle.",
    "One loop at a time, and only on screen. Tickers, Lucky's bob.",
    "No scroll-jacking, no auto-advancing carousels, no hover-only anything.",
    "Under reduced motion it all stops and the page still works.",
  ],
  durations: [
    { name: "instant", ms: 100, use: "press" },
    { name: "fast", ms: 160, use: "colour, small changes" },
    { name: "base", ms: 280, use: "default movement, sheet exit" },
    { name: "emphasis", ms: 400, use: "add to jar, the pop" },
    { name: "enter", ms: 420, use: "reveals, sheet enter" },
    { name: "slow", ms: 600, use: "large exits" },
  ],
} as const;

export const LAYOUT = [
  "Phone first. The design is the 390px layout; wider screens only add room.",
  "The button is on the first screen, and a sticky buy bar follows the thumb after that.",
  "Tap targets are 44px or more; the main buttons are 52 to 60.",
  "Cards: paper, 3px navy rule, 18px radius, a hard 5px offset.",
  "Sections alternate pink, cream and navy so a scroll has rhythm.",
  "Stickers are slapped on at an angle, a few at a time, never in a grid.",
] as const;

export const CHANGES = [
  {
    // copy-audit-ignore: describes the positioning that was removed.
    from: "Positioned in sports performance, as a shot against cramps.",
    to: "Positioned as a game-day ritual and a lucky charm.",
    why: "The first cannot legally be said about a food here. The second is in her own copy, is more distinctive, and is safe.",
  },
  {
    from: "Hero line: Never fear, Lucky is here.",
    to: "Hero line: A little shot of good luck. Never fear moves to the Meet Lucky section.",
    why: "A first-time visitor has to know what the product is in one glance. Shot does that; Never fear needs you to already know.",
  },
  {
    from: "Body text set in white or cream on pink.",
    to: "On pink, sentences sit on a cream card.",
    why: "Cream on pink is 3.8:1 and white is 4.25:1. Neither passes for sentence-sized text.",
  },
  {
    from: "A raster logo as the hero image.",
    to: "Lucky drawn inline from her vector paths, with his burst lines, speed lines and dust moving.",
    why: "Sharper, a fraction of the bytes, paints with the page, and he is alive.",
  },
  {
    from: "Flavour A, B and C placeholders.",
    to: "One juice in three pack sizes: The Trial, The Starter, The Squad.",
    why: "No flavours exist yet. Three sizes of one product is an honest offer and a better price ladder.",
  },
  {
    from: "Display type at 2.75 to 5.5rem.",
    to: "Summer Varsity sized to span the screen: up to a quarter of the viewport width per line.",
    why: "It is a very condensed face. At the suggested sizes it whispered.",
  },
  {
    from: "Hamburger menu and a bottom tab bar on phones.",
    to: "No menu on phones. A sticky buy bar instead.",
    why: "It is one page. Four links to places you can scroll to are a tap spent on nothing; the buy button is not.",
  },
  {
    from: "Lucky's special move on his player card: the pickle punch.",
    to: "Turning up. Every game.",
    why: "The punch is the front half of the one sentence this brand can never publish. Turning up is the promise we can keep, and it is funnier.",
  },
  {
    from: "A card that said we would not dress the juice up, try one and see.",
    to: "Made to hand round: a pack is for sharing.",
    why: "Try one and see leaves the reader to fill in an effect, which is a wink, which is a claim. The new card gives a reason to buy the bigger pack instead.",
  },
  {
    from: "One cream.",
    to: "Two: the UI cream sampled from the raster logo, and the art cream her vector pages are drawn in.",
    why: "Her own files use both. Recolouring her art to match would be redrawing it.",
  },
] as const;

/**
 * Where this guide comes from, and where it differs from Grok's drafts.
 * Ashleigh's own files outrank everything here.
 */
export const SOURCES = {
  hers: "The logo, Lucky, the three colours, the four fonts, the sticker sheet and her Meet Lucky page. Used as they are. Never redrawn, recoloured or reworded.",
  groks:
    "Brand Guide v2, the spec and tokens, and (12 November 2026) a strategy proposal, a tone-of-voice proposal and thirty questions for Ashleigh. All drafts waiting on her.",
  taken: [
    "The six checks, by name.",
    "The naming rules for Quick Pickle, Lucky and the Pickle Crew.",
    "Ritual words in, body words out. This guide already said it; theirs lists it better.",
    "Their finding that her exact words are Our little shot of good luck for the quads, so the hero line is ours, cut from hers, and is labelled that way.",
    "Holding back the pickle punch and Pickle Power.",
  ],
  differs: [
    {
      theirs: "Never fear, Lucky is here leads the home page.",
      ours: "A little shot of good luck leads. Never fear signs off Meet Lucky and runs in the ticker.",
      why: "The first screen has to say what is for sale. Never fear only lands once you have met Lucky.",
    },
    {
      theirs:
        // copy-audit-ignore: names the two deck sentences in order to rule them out.
        "The two sentences about physical barriers and the physical game stay in her story, pending legal advice.",
      ours: "Out entirely, and the scanner blocks them.",
      why: "On a page that sells the product they are the set-up for a claim, with or without the punchline.",
    },
    {
      theirs: "Format, size, market and checkout are open questions.",
      ours: "A 100 ml clear plastic bottle, sold direct in New Zealand, through our own checkout.",
      why: "Confirmed to this build on 12 November 2026, with photos of the bottle.",
    },
    {
      theirs: "Call him Lucky, never the cat.",
      ours: "He is Lucky everywhere, with one exception: the 404 page, where he is asleep and the joke is a napping cat.",
      why: "It is funnier, and it is one line.",
    },
  ],
} as const;
