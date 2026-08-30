import { test as setup } from "@playwright/test";

import { signInToAdmin } from "./admin";

/**
 * Sign in once, and keep the session for the admin project.
 *
 * Every admin page in this suite is reached through this — a real password
 * typed into the real form, with no bypass and no hand-written cookie, so the
 * admin assertions are also an assertion that the gate works. Doing it once
 * rather than per test is only a cost decision: argon2id is 19 MiB and ~85 ms
 * of deliberate work per verification, and sixteen admin routes is sixteen of
 * them.
 */
const ADMIN_STATE = ".scratch/e2e/admin-state.json";

setup("sign in to the admin", async ({ page }) => {
  await signInToAdmin(page);
  await page.context().storageState({ path: ADMIN_STATE });
});
