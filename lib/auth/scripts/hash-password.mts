#!/usr/bin/env node
/**
 * Generate the `ADMIN_PASSWORD_HASH` value.
 *
 *   npm run auth:hash-password
 *
 * Prompts for the password twice with the terminal echo off, prints the
 * argon2id PHC string, and prints nothing else. Paste the result into the
 * Vercel project's environment variables (or `.env.local` for development) as
 * `ADMIN_PASSWORD_HASH` and the new password is live on the next deploy.
 *
 * It can also take the password on stdin, for automation:
 *
 *   printf '%s' "$PASSWORD" | npm run --silent auth:hash-password
 *
 * The password is NEVER accepted as a command-line argument. Arguments end up
 * in shell history, in `ps` output for every user on the machine, and in CI
 * logs. Stdin does not.
 *
 * Nothing here writes the password to disk, echoes it, or includes it in an
 * error message. The only thing printed on success is the hash, which is safe
 * to paste around: recovering the password from it is the expensive problem
 * argon2id exists to create.
 */
import { createInterface } from "node:readline";
import { stdin, stdout, stderr, argv, exit } from "node:process";

import { argon2id } from "hash-wasm";

/**
 * OWASP's second recommended argon2id configuration: 19 MiB, t=2, p=1.
 *
 * Keep in sync with ARGON2_PARAMS in lib/auth/config.ts — `tests/auth/
 * hash-password-script.test.ts` fails the build if these drift apart.
 */
const MEMORY_KIB = 19456;
const ITERATIONS = 2;
const PARALLELISM = 1;
const HASH_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;

/** Below this, the hash is the only thing doing any work at all. */
const MINIMUM_LENGTH = 12;

async function readPipedInput(): Promise<string | null> {
  if (stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.from(chunk));
  }
  const value = Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
  return value === "" ? null : value;
}

/** Prompt with echo suppressed, so nothing lands in the scrollback. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: stdin,
      output: stdout,
      terminal: true,
    });
    stderr.write(question);
    const muted = rl as unknown as { output?: { write(chunk: string): void } };
    const original = muted.output?.write.bind(muted.output);
    if (muted.output !== undefined && original !== undefined) {
      muted.output.write = (chunk: string) => {
        if (chunk.includes("\n")) original(chunk);
      };
    }
    rl.question("", (answer) => {
      if (muted.output !== undefined && original !== undefined) {
        muted.output.write = original;
      }
      stderr.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  if (argv.length > 2) {
    stderr.write(
      "This script takes no arguments. Passing a password on the command line would leak it into shell history and process listings; it is read from a prompt or from stdin instead.\n",
    );
    exit(2);
  }

  const piped = await readPipedInput();
  let password: string;

  if (piped !== null) {
    password = piped;
  } else {
    password = await promptHidden("New admin password: ");
    const confirmation = await promptHidden("Confirm: ");
    if (password !== confirmation) {
      // Comparing two values the operator just typed, neither of them secret to
      // the operator: no timing concern, and no value is echoed either way.
      stderr.write("The two entries did not match. Nothing was generated.\n");
      exit(1);
    }
  }

  if (password.length === 0) {
    stderr.write("Empty password. Nothing was generated.\n");
    exit(1);
  }
  if (password.length < MINIMUM_LENGTH) {
    stderr.write(
      `Warning: ${String(password.length)} characters. This single password guards the whole business; ${String(MINIMUM_LENGTH)} or more, and not a dictionary word with a year on the end, is the difference between an offline attacker needing centuries and needing an afternoon.\n`,
    );
  }

  const salt = new Uint8Array(SALT_LENGTH_BYTES);
  crypto.getRandomValues(salt);

  const encoded = await argon2id({
    password,
    salt,
    parallelism: PARALLELISM,
    iterations: ITERATIONS,
    memorySize: MEMORY_KIB,
    hashLength: HASH_LENGTH_BYTES,
    outputType: "encoded",
  });

  stderr.write(
    `argon2id, m=${String(MEMORY_KIB)} KiB, t=${String(ITERATIONS)}, p=${String(PARALLELISM)}. Set this as ADMIN_PASSWORD_HASH:\n`,
  );
  stdout.write(`${encoded}\n`);
}

await main();
