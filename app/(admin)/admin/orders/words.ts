/**
 * The words Orders & Delivery uses, and the closed sets behind them.
 *
 * These live outside `actions.ts` because a `"use server"` module may export
 * nothing but async functions — Next enforces it, and rightly: anything else
 * exported from that file would be reachable as a server action.
 *
 * Every list here is a closed set checked on the server before it reaches the
 * database, so a hand-made `POST` cannot smuggle a courier or a reason the
 * screen never offered.
 */

/** The couriers this business actually uses. */
export const COURIERS = [
  "NZ Post",
  "CourierPost",
  "Post Haste",
  "Mainfreight",
  "Aramex",
  "Picked up in person",
] as const;

/** Why an order was cancelled. Mirrors what the commerce seam accepts. */
export const CANCEL_REASONS = [
  "customer",
  "inventory",
  "staff",
  "declined",
  "fraud",
  "other",
] as const;

export const CANCEL_WORDS: Readonly<Record<string, string>> = {
  customer: "The customer asked",
  inventory: "We cannot make it",
  staff: "My mistake",
  declined: "Payment did not go through",
  fraud: "It does not look genuine",
  other: "Something else",
};

/** Why money is going back. Mirrors `public.refund_reason`. */
export const REFUND_REASONS = [
  "damaged",
  "never_arrived",
  "wrong_thing",
  "changed_mind",
  "goodwill",
  "duplicate",
  "other",
] as const;

export const REFUND_WORDS: Readonly<Record<string, string>> = {
  damaged: "It arrived broken",
  never_arrived: "It never turned up",
  wrong_thing: "Wrong bottle in the box",
  changed_mind: "They changed their mind",
  goodwill: "Making it right",
  duplicate: "They were charged twice",
  other: "Something else",
};

/** A closed set as `<Select>` wants it. */
export function options(
  values: readonly string[],
  words: Readonly<Record<string, string>>,
): readonly { readonly value: string; readonly label: string }[] {
  return values.map((value) => ({ value, label: words[value] ?? value }));
}
