/**
 * Passwords: argon2id, at the settings OWASP recommends (19 MiB, 2 passes,
 * one lane). Stored as a PHC string, which carries its own salt and settings,
 * so the settings can be raised later without breaking anyone's sign-in.
 */

import { argon2id, argon2Verify } from "hash-wasm";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

const PARAMS = {
  memorySize: 19_456,
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
} as const;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${String(MIN_PASSWORD_LENGTH)} characters. A few words run together works well.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `That is longer than ${String(MAX_PASSWORD_LENGTH)} characters.`;
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    ...PARAMS,
    password,
    salt: crypto.getRandomValues(new Uint8Array(16)),
    outputType: "encoded",
  });
}

/**
 * A hash to check against when there is no such user, so "no such email" and
 * "wrong password" take the same time and cannot be told apart by a clock.
 */
let decoy: Promise<string> | null = null;
function decoyHash(): Promise<string> {
  decoy ??= hashPassword("not-a-real-password-just-a-decoy");
  return decoy;
}

/** True only when `hash` is a real hash of `password`. Never throws. */
export async function verifyPassword(
  password: string,
  hash: string | null,
): Promise<boolean> {
  try {
    if (hash === null || hash === "") {
      await argon2Verify({ password, hash: await decoyHash() });
      return false;
    }
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}
