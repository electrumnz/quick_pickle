/**
 * Constant-time comparison.
 *
 * Every secret comparison in this package goes through here. `===` on a string
 * or `Buffer.compare` both bail at the first differing byte, and that timing
 * difference is enough to recover a token byte-by-byte from a remote attacker
 * given enough samples. Nothing in the verification path may short-circuit.
 *
 * Deliberately implemented in plain JavaScript rather than `node:crypto`'s
 * `timingSafeEqual`: this code is imported by the request proxy, which must
 * stay portable across the Node and Edge runtimes, and `timingSafeEqual`
 * additionally throws on a length mismatch rather than returning false.
 */

/**
 * Compare two byte sequences without an early return.
 *
 * A length difference is folded into the same accumulator as the byte
 * differences, so the function still walks the full span and still returns
 * through the single exit below. Lengths themselves are not secret in any of
 * this package's uses — Argon2 digests, SHA-256 digests and CSRF tokens are all
 * fixed width — but they are not leaked through control flow either.
 */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const span = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < span; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

const utf8 = new TextEncoder();

/** Constant-time comparison of two strings, compared as their UTF-8 bytes. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  return timingSafeEqualBytes(utf8.encode(a), utf8.encode(b));
}
