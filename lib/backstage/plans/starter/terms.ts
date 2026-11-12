/**
 * The few scanned words the starter drafts cannot do without.
 *
 * The copy scanner (legal/scripts/audit-copy.mjs) reads every string in this
 * folder, and stops on one word in particular wherever it appears, because
 * next to a food that word is a claim. But the drafts have to name the rule
 * in order to state it, and one sheet is about exactly the question that
 * word describes.
 *
 * So those exact phrases live here, between markers, and the drafts refer to
 * them by name. Every other word of every draft is still read by the scanner.
 * None of these phrases says anything about the product, and none may be
 * used to.
 */

/* copy-audit-ignore-start: the name of the rule and of the sheet about it, used to state the rule. Never used to describe the product. */

/** The everyday name for the kind of claim a food may not make. */
export const HEALTH_CLAIMS = "health claims";

/** What a customer's question about their body is called on these sheets. */
export const HEALTH_QUESTION = "health question";

/** The address of the sheet that says how to answer one. */
export const HEALTH_QUESTION_SLUG = "how-to-answer-a-health-question";

/* copy-audit-ignore-end */

/** Where the starter drafts link to each other and to the other screens. */
export const LINK = {
  today: "/backstage",
  plans: "/backstage/plans",
  questions: "/backstage/plans/questions",
  tasks: "/backstage/plans/tasks",
  compliance: "/backstage/plans/compliance",
  budget: "/backstage/plans/budget",
  orders: "/backstage/orders",
  courier: "/backstage/orders/courier",
  books: "/backstage/numbers/books",
  customers: "/backstage/customers",
  brand: "/backstage/brand",
  goLive: "/backstage/settings/go-live",
  shop: "/backstage/settings/shop",
  label: "/backstage/settings/label",
  doc: (slug: string) => `/backstage/plans/docs/${slug}`,
} as const;
