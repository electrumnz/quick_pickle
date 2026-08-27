import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { ARGON2_PARAMS } from "@/lib/auth/config";
import { parseArgon2Hash, verifyPassword } from "@/lib/auth/crypto/argon2";

const run = promisify(execFile);

const SCRIPT = fileURLToPath(
  new URL("../../lib/auth/scripts/hash-password.mts", import.meta.url),
);

/**
 * The founder must be able to change her own password without help.
 *
 * So the script is tested like anything else: it is run, its output is fed to
 * the verifier that guards the door, and the parameters it bakes in are checked
 * against the ones the application expects. A hashing script that has drifted
 * from the verifier is a locked-out founder on a Sunday.
 */
describe("npm run auth:hash-password", () => {
  it("produces a hash the shipped verifier accepts", async () => {
    const password = "script-test-passphrase-not-production";
    const { stdout } = await run(process.execPath, [SCRIPT], {
      // Read from stdin, never from argv.
      input: password,
    } as Parameters<typeof run>[2] & { input: string });

    const encoded = stdout.trim();
    expect(encoded.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(password, encoded)).toBe(true);
    expect(await verifyPassword("something-else", encoded)).toBe(false);
  }, 60_000);

  it("refuses a password passed as an argument", async () => {
    await expect(
      run(process.execPath, [SCRIPT, "hunter2"], {
        input: "",
      } as Parameters<typeof run>[2] & { input: string }),
    ).rejects.toMatchObject({ code: 2 });
  }, 60_000);

  it("uses the same argon2id parameters the application expects", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const constant = (name: string): number => {
      const match = new RegExp(`const ${name} = (\\d+);`).exec(source);
      return Number(match?.[1] ?? Number.NaN);
    };

    expect(constant("MEMORY_KIB")).toBe(ARGON2_PARAMS.memoryKib);
    expect(constant("ITERATIONS")).toBe(ARGON2_PARAMS.iterations);
    expect(constant("PARALLELISM")).toBe(ARGON2_PARAMS.parallelism);
    expect(constant("HASH_LENGTH_BYTES")).toBe(ARGON2_PARAMS.hashLengthBytes);
    expect(constant("SALT_LENGTH_BYTES")).toBe(ARGON2_PARAMS.saltLengthBytes);
  });

  it("meets the 2026 OWASP baseline", async () => {
    const { stdout } = await run(process.execPath, [SCRIPT], {
      input: "another-script-test-passphrase",
    } as Parameters<typeof run>[2] & { input: string });
    const parsed = parseArgon2Hash(stdout.trim());
    expect(parsed?.memoryKib).toBeGreaterThanOrEqual(19456);
    expect(parsed?.iterations).toBeGreaterThanOrEqual(2);
    expect(parsed?.parallelism).toBeGreaterThanOrEqual(1);
    expect(parsed?.salt.length).toBeGreaterThanOrEqual(16);
    expect(parsed?.digest.length).toBeGreaterThanOrEqual(32);
  }, 60_000);
});
