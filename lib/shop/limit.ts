/**
 * How often the shop will answer one caller, by what they are asking.
 *
 * The checkout answers questions for anybody: is this code any good, has
 * this address used it, here is an order. Asked a few times that is the
 * shop working. Asked hundreds of times it is somebody guessing at codes,
 * asking about other people one email at a time, or flooding the order
 * book, so each kind of question has a ceiling for one caller in one
 * stretch of time.
 *
 * "One caller" is one internet address, and one address is often many
 * people: a club's wifi, a stall at an event, a phone company's shared
 * addresses. So what counts is kept to what a crowd of real buyers hardly
 * ever does:
 *
 *   code   a code we do not know (a wrong guess), and any question that
 *          names a person (an email sent with the code). A real code that
 *          is asked about counts for nothing, however many people ask.
 *   order  a press of the order button that got past the form's own
 *          checks, or that was told something about a code. A form handed
 *          back to have a field put right counts for nothing.
 *   crew   a sign-up to the Pickle Crew.
 *   knock  an app registering with, or handing a code or a key to, the
 *          back end's connection for Claude. Nothing a customer does.
 *   calls  a connected Claude calling the back end's tools, counted for
 *          each connection and not by address.
 *
 * This file imports nothing, so anything may read the numbers.
 */

export const LIMITS = {
  code: { most: 20, minutes: 10 },
  order: { most: 30, minutes: 10 },
  crew: { most: 20, minutes: 10 },
  // Not the shop's: an app knocking at the back end's connection for
  // Claude (registering, or handing in a code or a key). No customer does
  // this, and real apps do it a handful of times.
  knock: { most: 40, minutes: 10 },
  // Nor this: how often one connection may call the back end's tools. A
  // person talking to Claude makes a few a minute. A loop makes thousands.
  calls: { most: 600, minutes: 10 },
} as const;

export type Limited = keyof typeof LIMITS;

export const LIMITED = ["code", "order", "crew", "knock", "calls"] as const;

/** The start of the stretch of time a moment falls in. */
export function windowStartOf(now: Date, minutes: number): Date {
  const size = minutes * 60_000;
  return new Date(Math.floor(now.getTime() / size) * size);
}
