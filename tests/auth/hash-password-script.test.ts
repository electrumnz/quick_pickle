import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ARGON2_PARAMS } from "@/lib/auth/config";
import { parseArgon2Hash, verifyPassword } from "@/lib/auth/crypto/argon2";

const SCRIPT = fileURLToPath(
  new URL("../../lib/auth/scripts/hash-password.mts", import.meta.url),
);

/**
 * The founder must be able to change her own password without help.
 *
 * So the script is tested like anything else: it is run as a real process, its
 * output is fed to the verifier that guards the door, and the parameters it
 * bakes in are checked against the ones the application expects. A hashing
 * script that has drifted from the verifier is a locked-out founder on a
 * Sunday.
 */
type ScriptRun = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/** Run the script with `input` on stdin — never as an argument. */
function runScript(args: readonly string[], input: string): Promise<ScriptRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

describe("npm run auth:hash-password", () => {
  it(
    "produces a hash the shipped verifier accepts",
    { timeout: 60_000 },
    async () => {
      const password = "script-test-passphrase-not-production";
      const result = await runScript([], password);

      expect(result.code).toBe(0);
      const encoded = result.stdout.trim();
      expect(encoded.startsWith("$argon2id$")).toBe(true);
      expect(await verifyPassword(password, encoded)).toBe(true);
      expect(await verifyPassword("something-else", encoded)).toBe(false);
    },
  );

  it(
    "never echoes the password, on any stream",
    { timeout: 60_000 },
    async () => {
      const password = "script-test-passphrase-not-production";
      const result = await runScript([], password);
      expect(result.stdout).not.toContain(password);
      expect(result.stderr).not.toContain(password);
    },
  );

  it(
    "refuses a password passed as an argument",
    { timeout: 60_000 },
    async () => {
      const result = await runScript(["hunter2"], "");
      expect(result.code).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("takes no arguments");
      // And it certainly does not hash it.
      expect(result.stderr).not.toContain("hunter2");
    },
  );

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

  it("meets the 2026 OWASP baseline", { timeout: 60_000 }, async () => {
    const result = await runScript([], "another-script-test-passphrase");
    const parsed = parseArgon2Hash(result.stdout.trim());
    expect(parsed?.memoryKib).toBeGreaterThanOrEqual(19456);
    expect(parsed?.iterations).toBeGreaterThanOrEqual(2);
    expect(parsed?.parallelism).toBeGreaterThanOrEqual(1);
    expect(parsed?.salt.length).toBeGreaterThanOrEqual(16);
    expect(parsed?.digest.length).toBeGreaterThanOrEqual(32);
  });
});
