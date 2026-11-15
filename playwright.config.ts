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
  RESEND_WEBHOOK_SECRET: "",
  MAIL_INBOUND_SECRET: "",
  MAIL_TOKEN_SECRET: "",
};

/**
 * Both servers run from one build folder, each with its own records. A page
 * a server draws again is kept in that server's memory, never written into
 * the folder they share: otherwise a page drawn by one (its shop's prices
 * changed, or shut) could be served by the other. See next.config.ts.
 */
const OWN_PAGES = { QP_KEPT_PAGES: "memory" };

/**
 * The sentence a back-end page shows after a form is saved travels in the
 * address, sealed with a secret the server holds, and one that is not sealed
 * is taken out (lib/backstage/ui/notice.ts). Both servers are given a secret,
 * so every form these tests press goes through the seal as it does in
 * production. On the first server, which has no accounts, the set-up code
 * does nothing else. The clock's own secret is blanked so that a machine's
 * own environment cannot change which secret the seal is made with.
 */
const SEALED_NOTICES = { BACKSTAGE_SETUP_CODE: SETUP_CODE, CRON_SECRET: "" };

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
        ...SEALED_NOTICES,
        ...NO_MAIL,
        ...OWN_PAGES,
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
        ...SEALED_NOTICES,
        ...NO_MAIL,
        ...OWN_PAGES,
      },
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
