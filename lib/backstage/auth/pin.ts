/**
 * Coming in with a PIN: the door for now.
 *
 * The back end was built for named logins, an email and a password each.
 * While the shop is being set up there may be nobody with an address to
 * give it yet, so the first owner can be made with a PIN instead, and the
 * sign-in page then asks for the PIN and nothing else. (Sam, 15 November
 * 2026: "a link in the footer and a pin for now. its not a live active
 * website".)
 *
 * A PIN is short, and there is one of it, so everything here leans on
 * three things:
 *
 *   - **How often it can be guessed.** Wrong tries are counted for the door
 *     as a whole, not for whoever is trying: five in a day locks it, and
 *     each lock is twice the last, up to a day (throttle.ts). A right PIN
 *     wipes the count but not the ladder. In the steady state that is five
 *     guesses a day against about a million PINs.
 *   - **The set-up code.** The long phrase only whoever hosts the site can
 *     read. It makes the PIN, it sets a new one when the PIN is forgotten
 *     or the door is locked, and the PIN is mixed with it before it is
 *     hashed, so a copy of the database alone gives nobody the PIN.
 *     Change the set-up code and the PIN stops working: set a new one.
 *   - **It is for now.** The go-live list counts a PIN door as not ready,
 *     and Settings, Staff has one form that turns it into a proper login.
 *     From then on none of this is reachable.
 *
 * There is at most one PIN login. It is an ordinary owner account whose
 * email is the stand-in below, which is unique like every email, so a
 * second cannot be made. `.invalid` can never be a real address.
 */

import { createHmac } from "node:crypto";

type Env = Record<string, string | undefined>;

/** The stand-in address that marks the PIN login. Never a real mailbox. */
export const PIN_LOGIN = "pin@backstage.invalid";

export const PIN_SHORTEST = 6;
export const PIN_LONGEST = 12;

/** True for the account that comes in with the PIN. */
export function isPinLogin(account: { readonly email: string }): boolean {
  return account.email === PIN_LOGIN;
}

/**
 * Favourites that the three rules below do not catch: pairs, mirrors and
 * the shapes a keypad makes. Every list of leaked PINs starts with these.
 */
const WELL_KNOWN = new Set([
  "112233",
  "123321",
  "789456",
  "456123",
  "123654",
  "321654",
  "654123",
  "159753",
  "159357",
  "357159",
  "147258",
  "258369",
  "147369",
  "369258",
  "741852",
  "852963",
  "001122",
  "998877",
  "445566",
  "778899",
  "100000",
  "123450",
  "111222",
  "222333",
  "100200",
]);

/** The same few digits over and over: 111111, 121212, 123123. */
function repeats(pin: string): boolean {
  for (let size = 1; size <= pin.length / 2; size += 1) {
    if (pin.length % size !== 0) continue;
    if (pin.slice(0, size).repeat(pin.length / size) === pin) return true;
  }
  return false;
}

/**
 * Every step from one digit to the next is the same, round the dial:
 * 123456, 987654, 135791, 890123.
 */
function marches(pin: string): boolean {
  const digits = [...pin].map(Number);
  const step = ((digits[1] ?? 0) - (digits[0] ?? 0) + 10) % 10;
  return digits.every(
    (digit, index) =>
      index === 0 || (digit - (digits[index - 1] ?? 0) + 10) % 10 === step,
  );
}

/** What is wrong with a PIN somebody wants to use, as a sentence, or null. */
export function pinProblem(pin: string): string | null {
  if (!/^[0-9]+$/.test(pin)) return "A PIN is digits only.";
  if (pin.length < PIN_SHORTEST) {
    return `Use at least ${String(PIN_SHORTEST)} digits.`;
  }
  if (pin.length > PIN_LONGEST) {
    return `Keep it to ${String(PIN_LONGEST)} digits.`;
  }
  if (repeats(pin) || marches(pin) || WELL_KNOWN.has(pin)) {
    return "That one is too easy to guess. Pick digits with no pattern to them.";
  }
  return null;
}

/**
 * The secret the PIN is mixed with: the set-up code, when there is a real
 * one. With none there is no PIN door at all.
 */
export function pinSecret(env: Env = process.env): string | null {
  const code = (env.BACKSTAGE_SETUP_CODE ?? "").trim();
  return code.length >= 16 ? code : null;
}

/**
 * The PIN as it is hashed and checked: mixed with the secret first. What
 * is stored is an argon2id hash of this, so the million possible PINs
 * cannot be tried against a copy of the database without the secret too.
 */
export function seasoned(pin: string, secret: string): string {
  return createHmac("sha256", `quick-pickle-pin:${secret}`)
    .update(pin)
    .digest("hex");
}
