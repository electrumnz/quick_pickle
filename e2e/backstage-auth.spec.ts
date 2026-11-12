import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { AUTH_URL, SETUP_CODE } from "./auth-server";

/**
 * The back end's door, from the outside.
 *
 * These run against the second server (see playwright.config.ts), which has
 * the door shut. It keeps one set of accounts in memory for the whole run, so
 * the tests go in order and only one browser project runs them.
 */

test.describe.configure({ mode: "serial" });
test.skip(
  ({ isMobile }) => !isMobile,
  "the server keeps one set of accounts, so one browser runs this",
);

const OWNER = {
  name: "Ash Lennard",
  email: "ash@example.co.nz",
  password: "same socks since the semi",
};
const STAFF = {
  name: "Sam Sideline",
  email: "sam@example.co.nz",
  password: "three bounces before the serve",
};

/**
 * Press a form's button and wait for the answer to land.
 *
 * React clears a form's fields when its action finishes, just after the reply
 * arrives. A person never notices. A test that types into the next field in
 * the same millisecond has its typing wiped, so every submit here waits for
 * the reply itself, and then for the button to stop saying it is busy.
 */
async function press(page: Page, name: RegExp) {
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page.getByRole("button", { name }).click(),
  ]);
  await page.waitForFunction(
    () => document.querySelector('button[aria-disabled="true"]') === null,
  );
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${AUTH_URL}/backstage/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await press(page, /sign in/i);
}

test("nothing behind the door opens without signing in", async ({ page }) => {
  for (const path of [
    "/backstage",
    "/backstage/settings/staff",
    "/backstage/settings/activity",
    "/backstage/brand",
  ]) {
    await page.goto(`${AUTH_URL}${path}`);
    // No accounts exist yet, so the sign-in page hands on to set-up.
    await expect(page).toHaveURL(/\/backstage\/(sign-in|set-up)/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /sign in|set up/i,
    );
  }
});

test("set-up makes the first owner, with the code and only once", async ({
  page,
}) => {
  await page.goto(`${AUTH_URL}/backstage/set-up`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/set up/i);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    ),
  ).toEqual([]);

  await page.getByLabel("Set-up code").fill("not the code at all, sorry");
  await page.getByLabel("Your name").fill(OWNER.name);
  await page.getByLabel("Your email").fill(OWNER.email);
  await page.getByLabel("Choose a password").fill(OWNER.password);
  await press(page, /create my login/i);
  await expect(page.getByText("That is not the set-up code")).toBeVisible();
  // What was typed is still there, apart from the secrets.
  await expect(page.getByLabel("Your name")).toHaveValue(OWNER.name);
  await expect(page.getByLabel("Choose a password")).toHaveValue("");

  await page.getByLabel("Set-up code").fill(SETUP_CODE);
  await page.getByLabel("Choose a password").fill("short");
  await press(page, /create my login/i);
  await expect(page.getByText(/^Use at least 12 characters/)).toHaveCount(1);
  await expect(page.getByText("That is not the set-up code")).toHaveCount(0);

  await page.getByLabel("Set-up code").fill(SETUP_CODE);
  await page.getByLabel("Choose a password").fill(OWNER.password);
  await press(page, /create my login/i);

  await expect(page).toHaveURL(`${AUTH_URL}/backstage`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ash");
  // A real back end never says it is a demo.
  await expect(page.getByText(/made up and reset/i)).toHaveCount(0);

  // The session cookie is out of reach of any script on the page.
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name.endsWith("qp_staff"));
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie)).not.toContain("qp_staff");

  // And the set-up page is gone for good.
  await page.goto(`${AUTH_URL}/backstage/set-up`);
  await expect(page).toHaveURL(/\/backstage(\/sign-in)?$/);
});

test("an owner invites staff with a one-time link", async ({
  page,
  browser,
}) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto(`${AUTH_URL}/backstage/settings/staff`);

  await page.getByLabel("Name", { exact: true }).fill(STAFF.name);
  await page.getByLabel("Email", { exact: true }).fill(STAFF.email);
  await press(page, /^invite$/i);

  const link = await page.getByLabel("One-time link").inputValue();
  expect(link).toContain("/backstage/password?token=");

  // Sam opens the link on a different device.
  const other = await browser.newContext();
  const sam = await other.newPage();
  await sam.goto(link);
  await sam.getByLabel("New password").fill(STAFF.password);
  await sam.getByLabel("And once more").fill("something else entirely");
  await press(sam, /save and sign in/i);
  await expect(sam.getByText("Those two don't match")).toBeVisible();

  await sam.getByLabel("New password").fill(STAFF.password);
  await sam.getByLabel("And once more").fill(STAFF.password);
  await press(sam, /save and sign in/i);
  await expect(sam).toHaveURL(`${AUTH_URL}/backstage`);
  await expect(sam.getByRole("heading", { level: 1 })).toContainText("Sam");

  // Staff can see who is on the team but cannot change it.
  await sam.goto(`${AUTH_URL}/backstage/settings/staff`);
  await expect(sam.getByText(OWNER.email)).toBeVisible();
  await expect(sam.getByRole("button", { name: /^invite$/i })).toHaveCount(0);
  await expect(sam.getByRole("button", { name: /switch off/i })).toHaveCount(0);

  // The link is spent.
  const again = await other.newPage();
  await again.goto(link);
  await again.getByLabel("New password").fill("another long password");
  await again.getByLabel("And once more").fill("another long password");
  await press(again, /save and sign in/i);
  await expect(again.getByText(/used or has run out/i)).toBeVisible();
  await other.close();

  // The owner sees it all in the activity log.
  await page.goto(`${AUTH_URL}/backstage/settings/activity`);
  await expect(page.getByText(`Invited ${STAFF.name} as staff`)).toBeVisible();
  await expect(page.getByText(`${STAFF.name} chose a password`)).toBeVisible();
});

test("signing out shuts the door; a wrong password does not open it", async ({
  page,
}) => {
  await signIn(page, OWNER.email, OWNER.password);
  await expect(page).toHaveURL(`${AUTH_URL}/backstage`);

  await page.goto(`${AUTH_URL}/backstage/more`);
  await press(page, /sign out/i);
  await expect(page).toHaveURL(/\/backstage\/sign-in/);
  await page.goto(`${AUTH_URL}/backstage/settings/activity`);
  await expect(page).toHaveURL(/\/backstage\/sign-in\?next=/);

  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill("definitely not the password");
  await press(page, /sign in/i);
  await expect(page.locator("main [role=alert]")).toHaveText(
    /don't match an account/i,
  );
  // An unknown email reads exactly the same.
  await page.getByLabel("Email").fill("nobody@example.co.nz");
  await page.getByLabel("Password").fill("definitely not the password");
  await press(page, /sign in/i);
  await expect(page.locator("main [role=alert]")).toHaveText(
    /don't match an account/i,
  );

  // The right one lands on the page that was asked for.
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await press(page, /sign in/i);
  await expect(page).toHaveURL(`${AUTH_URL}/backstage/settings/activity`);
});

test("an owner can switch an account off, and it stays out", async ({
  page,
  browser,
}) => {
  const other = await browser.newContext();
  const sam = await other.newPage();
  await signIn(sam, STAFF.email, STAFF.password);
  await expect(sam).toHaveURL(`${AUTH_URL}/backstage`);

  await signIn(page, OWNER.email, OWNER.password);
  await page.goto(`${AUTH_URL}/backstage/settings/staff`);
  const row = page.getByRole("listitem").filter({ hasText: STAFF.email });
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    row.getByRole("button", { name: /switch off/i }).click(),
  ]);
  await expect(page.locator("main [role=status]")).toHaveText(/saved/i);
  await expect(row.getByText(/switched off/i)).toBeVisible();

  // Sam's open session is dead at once, and the password no longer works.
  await sam.goto(`${AUTH_URL}/backstage`);
  await expect(sam).toHaveURL(/\/backstage\/sign-in/);
  await signIn(sam, STAFF.email, STAFF.password);
  await expect(sam.locator("main [role=alert]")).toHaveText(
    /don't match an account/i,
  );
  await other.close();

  // The last owner cannot be switched off.
  const mine = page.getByRole("listitem").filter({ hasText: OWNER.email });
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    mine.getByRole("button", { name: /switch off/i }).click(),
  ]);
  await expect(page.locator("main [role=alert]")).toHaveText(/no owner/i);
});
