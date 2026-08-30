import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

/**
 * The admin gate, as the browser tests meet it.
 *
 * There is no test bypass and no seeded cookie: {@link signInToAdmin} types a
 * password into the real login form, which means every admin screenshot and
 * every admin assertion in this suite is also proof that the gate, the session
 * and the page work together. `components/admin/evidence/capture.mjs` does the
 * same thing for the same reason.
 */

/**
 * The password the e2e web server is configured to accept.
 *
 * Not a secret, and deliberately written down beside its own hash: it exists
 * only for a server this suite starts on localhost, and the real deployment
 * reads `ADMIN_PASSWORD_HASH` from its hosting environment and never from here.
 * Override both together to point the suite at a server somebody else started.
 */
export const ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? "half-sour-e2e-password";

/** argon2id, m=19456 KiB, t=2, p=1 — the hash of {@link ADMIN_PASSWORD}. */
const ADMIN_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$U6BI9jBlDJWaG9+YiCngGw$t2o+oYSmx5570CspXKJgsAc3YZ3xglCq0ES5jlhJDiU";

const DOTENV_FILES = [
  ".env.production.local",
  ".env.local",
  ".env.production",
  ".env",
];

/**
 * Whether a dotenv file in the repository root declares `ADMIN_PASSWORD_HASH`.
 *
 * This decides how the value has to be spelled, and the reason is worth
 * writing down because it costs an hour every time somebody meets it. Next
 * loads its `.env` files through dotenv-expand, and dotenv-expand does not
 * merely fill in values it parsed — for every key its files declare, it takes
 * whatever is in `process.env`, runs `$NAME` interpolation over it, and writes
 * the result back. An argon2id PHC string is almost entirely dollar signs, so
 * `$argon2id`, `$v` and `$m` are all read as undefined variables and replaced
 * with nothing. The value that reaches `lib/auth/config.ts` is a stump, and the
 * sign-in page correctly reports it as mangled — see `describeAuthConfigGaps`,
 * which names this exact failure.
 *
 * The defence is to escape each `$`: dotenv-expand leaves `\$` alone during
 * interpolation and unescapes it afterwards. But that only holds when the
 * expansion pass runs at all, and it runs only over keys a dotenv file
 * declares. On a machine with no `.env.local` — CI — an escaped value would
 * arrive with its backslashes intact and be just as broken. So the spelling
 * depends on the tree, and this function is what asks.
 */
function dotenvDeclaresPasswordHash(root: string): boolean {
  return DOTENV_FILES.some((file) => {
    const full = path.join(root, file);
    if (!existsSync(full)) return false;
    return /^\s*(?:export\s+)?ADMIN_PASSWORD_HASH\s*=/m.test(
      readFileSync(full, "utf8"),
    );
  });
}

/**
 * Environment for the Next server the suite starts.
 *
 * `COMMERCE_PROVIDER` is the seam the purchase journey is run across; the admin
 * values put a password on the gate that {@link signInToAdmin} knows.
 */
export function e2eServerEnv(
  provider: string,
  root: string = process.cwd(),
): Record<string, string> {
  const escape = dotenvDeclaresPasswordHash(root);
  return {
    COMMERCE_PROVIDER: provider,
    ADMIN_PASSWORD_HASH: escape
      ? ADMIN_PASSWORD_HASH.replaceAll("$", "\\$")
      : ADMIN_PASSWORD_HASH,
  };
}

/** Sign in through the real form. Leaves the browser on the admin. */
export async function signInToAdmin(page: Page): Promise<void> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  // A deployment with no admin secrets renders the gap list instead of the
  // form. That is correct behaviour and a useless test failure, so say which
  // it is rather than timing out on a missing field.
  const field = page.locator("#admin-password");
  await expect(
    field,
    "the login form is not on /login — the server was started without the admin secrets this suite sets in e2eServerEnv",
  ).toBeVisible();

  await field.fill(ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 30_000,
    }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}
