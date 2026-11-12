/**
 * Saved replies: the words, and the blanks in them.
 *
 * A template is plain text with a few blanks in double curly brackets. When
 * one is put into a reply the blanks we know the answer to are filled in.
 * The ones we do not know are left exactly as they are, brackets and all, so
 * they are seen and fixed: a reply is never sent with a blank where a name
 * should be, and `mail.send` refuses one that still has brackets in it.
 *
 * The starter replies at the bottom are loaded into a new back end (and the
 * demo) by `mail.loadStarterTemplates`. Each is bound by legal/COPY-RULES.md
 * like every other word the business sends: none says what the product does
 * to a body, and the one that answers a question about that says only that
 * we cannot.
 */

/** The blanks a template may use, and what goes in each. */
export const PLACEHOLDERS = [
  { key: "first_name", fills: "the person's first name" },
  { key: "name", fills: "their whole name" },
  { key: "order_number", fills: "the order this conversation is about" },
  { key: "carrier", fills: "the courier that order went with" },
  { key: "tracking_number", fills: "its tracking number" },
  { key: "tracking_link", fills: "its tracking link" },
] as const;

export type PlaceholderKey = (typeof PLACEHOLDERS)[number]["key"];

const BLANK = /\{\{\s*([a-z][a-z0-9_]{0,39})\s*\}\}/gi;

/**
 * Fill in the blanks we have answers for. An unknown blank, or one whose
 * answer is empty, is left as written.
 */
export function fillTemplate(
  text: string,
  values: Readonly<Partial<Record<PlaceholderKey, string | null>>>,
): string {
  return text.replace(BLANK, (whole, key: string) => {
    const value = (values as Record<string, string | null | undefined>)[
      key.toLowerCase()
    ];
    return typeof value === "string" && value.trim() !== ""
      ? value.trim()
      : whole;
  });
}

/** The blanks still in a piece of text, as written, each once. */
export function unfilledBlanks(text: string): string[] {
  return [...new Set([...text.matchAll(BLANK)].map((match) => match[0]))];
}

/**
 * A first name to greet someone by, from the name on their email, or null
 * when the name is not a person's ("Parcel updates", an address, nothing).
 */
export function firstNameFrom(name: string): string | null {
  const tidy = name.replace(/\s+/g, " ").trim();
  if (tidy === "" || tidy.includes("@")) return null;
  // "Carter, Liam" is surname first.
  const given = tidy.includes(",") ? (tidy.split(",")[1] ?? "").trim() : tidy;
  const [first] = given.split(" ");
  return first !== undefined && /^\p{Lu}[\p{L}'’-]{1,29}$/u.test(first)
    ? first
    : null;
}

export type StarterTemplate = {
  readonly name: string;
  /** Empty: leave the reply's subject as it is. */
  readonly subject: string;
  readonly body: string;
};

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    name: "Where is my order",
    subject: "",
    body: [
      "Hi {{first_name}},",
      "",
      "Thanks for getting in touch. Your order {{order_number}} left us with {{carrier}}, and the tracking number is {{tracking_number}}.",
      "",
      "If it has not turned up in a couple of days, reply to this email and we will chase the courier for you.",
    ].join("\n"),
  },
  {
    name: "Damaged in the post",
    subject: "",
    // Says what the returns policy says (content/policies.ts). Change both together.
    body: [
      "Hi {{first_name}},",
      "",
      "Sorry your order arrived like that. We will replace it or give you your money back, whichever you would rather. Just tell us which.",
      "",
      "A photo of the parcel helps us sort it out with the courier, but you will not be left waiting on them.",
    ].join("\n"),
  },
  {
    // copy-audit-ignore: the name of the reply that declines to answer. It says what we will NOT do.
    name: "We cannot give health advice",
    subject: "",
    body: [
      "Hi {{first_name}},",
      "",
      // copy-audit-ignore: a disclaimer, word for word from legal/COPY-RULES.md section 5. It says what the product is NOT.
      "Thanks for asking. Quick Pickle is a food and we don't make health claims about it. Your doctor or physio is the one to ask.",
    ].join("\n"),
  },
  {
    name: "Thanks for the review",
    subject: "",
    body: [
      "Hi {{first_name}},",
      "",
      "Thanks for taking the time to tell us what you thought. It means a lot.",
    ].join("\n"),
  },
  {
    name: "Wholesale enquiry",
    subject: "",
    body: [
      "Hi {{first_name}},",
      "",
      "Thanks for thinking of us. So we can work out what we can do, could you tell us:",
      "",
      "- who you are buying for (a club, a shop, an event)",
      "- roughly how many shots you are after, and how often",
      "- when you would need the first lot",
      "",
      "Once we know that, we will come back to you with what we can offer.",
    ].join("\n"),
  },
];
