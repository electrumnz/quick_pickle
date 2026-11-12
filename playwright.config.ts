import { defineConfig, devices } from "@playwright/test";

/**
 * The browser suite. Phone first, like the site: the `phone` project is the
 * one that has to pass, `desktop` checks the layout that is layered on top.
 *
 * CI runs the production build (`next start`), which is what Vercel serves.
 * Locally `next dev` keeps the loop fast. Neither server has a database, so
 * both run on the in-process one, in memory, and payments stay on the test
 * provider.
 */

import { AUTH_URL, SETUP_CODE } from "./e2e/auth-server";

const port = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${String(port)}`;
const isCI = Boolean(process.env.CI);

/**
 * Email is never connected on a test server, whatever the machine running
 * the tests happens to have set. (Neither server has a database, which is
 * enough by itself to stop anything being sent. This also keeps what the
 * screens say about email the same on every machine.)
 */
const NO_MAIL = {
  MAIL_PROVIDER: "off",
  RESEND_API_KEY: "",
  MAIL_FROM: "",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "phone",
      // Chromium with a phone's viewport, touch and user agent.
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: isCI
        ? `npx next start --port ${String(port)}`
        : `npx next dev --port ${String(port)}`,
      url: baseURL,
      env: {
        // Orders go to the database (the default), which here is the
        // in-process one, so an order placed in the shop can be found in the
        // back end by the same test.
        PAYMENT_PROVIDER: "test",
        NEXT_PUBLIC_SITE_URL: baseURL,
        QP_EMBEDDED_DB: "memory",
        ...NO_MAIL,
      },
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      // A second copy with the back end's door shut, for the sign-in tests
      // (see e2e/auth-server.ts). Always the production server: Next allows
      // one `next dev` per folder.
      command: `npx next start --port ${String(port + 1)}`,
      url: `${AUTH_URL}/backstage/sign-in`,
      env: {
        PAYMENT_PROVIDER: "test",
        NEXT_PUBLIC_SITE_URL: AUTH_URL,
        QP_EMBEDDED_DB: "memory",
        BACKSTAGE_AUTH: "required",
        BACKSTAGE_SETUP_CODE: SETUP_CODE,
        ...NO_MAIL,
      },
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
