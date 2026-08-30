import { defineConfig, devices } from "@playwright/test";

import { e2eServerEnv } from "./e2e/support/admin";
import {
  PROVIDER_PROJECT_PREFIX,
  providersUnderTest,
} from "./e2e/support/providers";

/**
 * The browser suite.
 *
 * NOTE: this file deliberately does NOT load `.env.local`. `@next/env` marks a
 * process it has loaded with `__NEXT_PROCESSED_ENV`, that marker is inherited
 * by every child, and a `next start` that sees it skips loading its own env
 * files — which quietly changes how the values this config passes are read.
 * The one process that needs the dotenv values is the test worker, and it loads
 * them for itself in `e2e/support/commerce.ts`, where it spawns nothing.
 */

/**
 * Which commerce providers the purchase journey runs against.
 *
 * The whole reason `lib/commerce/provider.ts` exists is that the storefront
 * cannot tell which implementation it has, so the journey is written once and
 * run once per name here — one Next server each, one Playwright project each,
 * the provider named in the project so a failure says which backend it was.
 *
 *   E2E_COMMERCE_PROVIDERS=mock npm run test:e2e          # the fast loop
 *   E2E_COMMERCE_PROVIDERS=mock,shopify npm run test:e2e  # the default
 *
 * `shopify` is in the default set on purpose. Its provider is not implemented
 * yet (unit C1) and there are no credentials in CI, so what it proves today is
 * the other half of the contract: a storefront whose catalogue cannot be
 * reached must still read and must withdraw ordering rather than offer a price
 * it cannot honour. When C1 lands with tokens, the same spec runs the full
 * journey against it with no edit — see `e2e/purchase.spec.ts`.
 */
const providers = providersUnderTest();

/**
 * Where the signed-in admin session is kept between projects.
 *
 * `.scratch/` is gitignored and is where this repository already puts private
 * build directories, so a session cookie cannot be committed by accident.
 */
const ADMIN_STATE = ".scratch/e2e/admin-state.json";

const basePort = Number(process.env.PORT ?? 3000);
const isCI = Boolean(process.env.CI);

/** One port per provider, so the servers cannot be mistaken for each other. */
const portFor = (index: number): number => basePort + index;
const urlFor = (index: number): string =>
  `http://localhost:${String(portFor(index))}`;

/** The first provider's server also serves the accessibility and no-JS passes. */
const primaryURL = urlFor(0);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: primaryURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    // Signs in through the real login form once and saves the session, so the
    // admin passes do not spend an argon2id verification per test.
    {
      name: "admin-setup",
      testMatch: /support\/admin\.setup\.ts$/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/purchase\.spec\.ts$/, /a11y-admin\.spec\.ts$/],
    },
    {
      name: "admin",
      use: {
        ...devices["Desktop Chrome"],
        storageState: ADMIN_STATE,
      },
      dependencies: ["admin-setup"],
      testMatch: /a11y-admin\.spec\.ts$/,
    },
    ...providers.map((provider, index) => ({
      name: `${PROVIDER_PROJECT_PREFIX}${provider}`,
      use: { ...devices["Desktop Chrome"], baseURL: urlFor(index) },
      testMatch: /purchase\.spec\.ts$/,
    })),
  ],

  webServer: providers.map((provider, index) => ({
    // CI exercises the production build, which is what Vercel actually serves.
    // Locally `next dev` keeps the edit/refresh loop fast.
    command: isCI
      ? `npx next start --port ${String(portFor(index))}`
      : `npx next dev --port ${String(portFor(index))}`,
    url: urlFor(index),
    env: e2eServerEnv(provider),
    reuseExistingServer: !isCI,
    timeout: 120_000,
  })),
});
