import { defineConfig, devices } from "@playwright/test";

/**
 * The browser suite. Phone first, like the site: the `phone` project is the
 * one that has to pass, `desktop` checks the layout that is layered on top.
 *
 * CI runs the production build (`next start`), which is what Vercel serves.
 * Locally `next dev` keeps the loop fast. Orders go to the file store under
 * `.data/`, and payments stay on the test provider.
 */

import { AUTH_URL, SETUP_CODE } from "./e2e/auth-server";

const port = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${String(port)}`;
const isCI = Boolean(process.env.CI);

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
        ORDER_STORE: "file",
        PAYMENT_PROVIDER: "test",
        NEXT_PUBLIC_SITE_URL: baseURL,
        QP_EMBEDDED_DB: "memory",
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
        ORDER_STORE: "log",
        PAYMENT_PROVIDER: "test",
        NEXT_PUBLIC_SITE_URL: AUTH_URL,
        QP_EMBEDDED_DB: "memory",
        BACKSTAGE_AUTH: "required",
        BACKSTAGE_SETUP_CODE: SETUP_CODE,
      },
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
