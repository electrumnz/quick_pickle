import { argon2id } from "hash-wasm";

import { ARGON2_PARAMS, type Argon2Params } from "../config";
import { timingSafeEqualBytes } from "./constant-time";
import { type Bytes, fromStandardBase64 } from "./encoding";
import { randomBytes } from "./random";

/**
 * Argon2id password hashing and verification.
 *
 * argon2id — not bcrypt, not scrypt, not PBKDF2, and emphatically not a fast
 * hash. It is the memory-hard, side-channel-resistant hybrid: the `d` half
 * makes GPU and ASIC cracking expensive by forcing 19 MiB of working set per
 * guess, the `i` half keeps the data-dependent addressing away from the salt.
 * For a door held shut by a single human-chosen password, the cost per guess an
 * offline attacker pays is the whole defence, so the parameters here are the
 * OWASP baseline and are not to be trimmed for latency.
 *
 * The plaintext password is never logged, never included in an error message,
 * never written to disk and never passed as a process argument.
 */

/** A parsed Argon2 PHC string: `$argon2id$v=19$m=..,t=..,p=..$salt$hash`. */
export type ParsedArgon2Hash = {
  readonly memoryKib: number;
  readonly iterations: number;
  readonly parallelism: number;
  readonly salt: Bytes;
  readonly digest: Bytes;
};

const PHC_PATTERN =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)={0,2}\$([A-Za-z0-9+/]+)={0,2}$/;

/**
 * Produce an Argon2id PHC string for `password`.
 *
 * Used by `npm run auth:hash-password` and by tests. Never called on the login
 * path — verification recomputes against the stored salt instead.
 */
export async function hashPassword(
  password: string,
  params: Argon2Params = ARGON2_PARAMS,
): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(params.saltLengthBytes),
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memoryKib,
    hashLength: params.hashLengthBytes,
    outputType: "encoded",
  });
}

/** Parse a stored PHC string. Returns null when it is not a usable argon2id hash. */
export function parseArgon2Hash(encoded: string): ParsedArgon2Hash | null {
  const match = PHC_PATTERN.exec(encoded.trim());
  if (match === null) return null;

  const [, memory, iterations, parallelism, salt, digest] = match;
  if (
    memory === undefined ||
    iterations === undefined ||
    parallelism === undefined ||
    salt === undefined ||
    digest === undefined
  ) {
    return null;
  }

  try {
    return {
      memoryKib: Number.parseInt(memory, 10),
      iterations: Number.parseInt(iterations, 10),
      parallelism: Number.parseInt(parallelism, 10),
      salt: fromStandardBase64(salt),
      digest: fromStandardBase64(digest),
    };
  } catch {
    return null;
  }
}

/**
 * Verify `password` against a stored Argon2id PHC string.
 *
 * The library's own `argon2Verify` is deliberately not used: it compares the
 * recomputed digest internally and this package will not take on faith that the
 * comparison is constant time. Instead the stored parameters and salt are
 * re-applied, the digest is recomputed, and the two are compared here through
 * {@link timingSafeEqualBytes} — a single exit, no early return, no `===` on a
 * secret anywhere in this function.
 */
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parsed = parseArgon2Hash(encoded);
  if (parsed === null) {
    // A malformed stored hash is a deployment fault, not an attacker signal.
    // The offending value is never echoed.
    return false;
  }

  const recomputed = await argon2id({
    password,
    salt: parsed.salt,
    parallelism: parsed.parallelism,
    iterations: parsed.iterations,
    memorySize: parsed.memoryKib,
    hashLength: parsed.digest.length,
    outputType: "binary",
  });

  return timingSafeEqualBytes(recomputed, parsed.digest);
}

/** Describe stored parameters for diagnostics. Reveals no salt and no digest. */
export function describeArgon2Hash(encoded: string): string {
  const parsed = parseArgon2Hash(encoded);
  if (parsed === null) return "argon2id(unparseable)";
  return `argon2id(m=${String(parsed.memoryKib)}KiB,t=${String(parsed.iterations)},p=${String(parsed.parallelism)},saltBytes=${String(parsed.salt.length)},hashBytes=${String(parsed.digest.length)})`;
}
