import AxeBuilder from "@axe-core/playwright";
import {
  Client,
  StreamableHTTPClientTransport,
  type OAuthClientProvider,
} from "@modelcontextprotocol/client";
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
 * The owner starts out coming in with a PIN (the door for now), sets a new
 * one with the set-up code, and then swaps it for the email and password
 * every later test signs in with.
 */
const PIN = "408137";
const NEW_PIN = "5920486";

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

/** Every accessibility rule, on the page as it stands. */
async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    ),
  ).toEqual([]);
}

async function signOut(page: Page) {
  await page.goto(`${AUTH_URL}/backstage/more`);
  await press(page, /sign out/i);
  await expect(page).toHaveURL(/\/backstage\/sign-in/);
}

test("the shop's footer leads to set-up, which makes the first owner with a PIN, once", async ({
  page,
}) => {
  // The way in is a quiet link at the foot of the shop. It is a full page
  // load, so the back end's stylesheet is never stacked on the shop's.
  await page.goto(`${AUTH_URL}/`);
  await page.evaluate(() => {
    (window as unknown as { cameFromShop?: boolean }).cameFromShop = true;
  });
  const way = page.getByRole("contentinfo").getByRole("link", {
    name: "Staff",
    exact: true,
  });
  await expect(way).toHaveAttribute("href", "/backstage");
  await expect(way).toHaveAttribute("rel", "nofollow");
  await way.click();
  // No accounts exist yet, so the door hands on to set-up.
  await expect(page).toHaveURL(`${AUTH_URL}/backstage/set-up`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/set up/i);
  expect(
    await page.evaluate(
      () => (window as unknown as { cameFromShop?: boolean }).cameFromShop,
    ),
  ).toBeUndefined();
  await expectNoAxeViolations(page);

  // It asks for a name and a PIN. No email.
  await expect(page.getByLabel(/email/i)).toHaveCount(0);

  // The other way to set up is one link away: an email and a password. It
  // says what the address is for, and holds a password to its length.
  await page
    .getByRole("link", { name: /email and a password instead/i })
    .click();
  await expect(page).toHaveURL(`${AUTH_URL}/backstage/set-up?with=email`);
  await expect(page.getByText(/Only your login name/)).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByLabel("Set-up code").fill(SETUP_CODE);
  await page.getByLabel("Your name").fill(OWNER.name);
  await page.getByLabel("Your email").fill(OWNER.email);
  await page.getByLabel("Choose a password").fill("short");
  await press(page, /create my login/i);
  await expect(page.getByText(/^Use at least 12 characters/)).toHaveCount(1);
  await expect(page.getByLabel("Your email")).toHaveValue(OWNER.email);
  await page.getByRole("link", { name: /use a pin instead/i }).click();
  await expect(page).toHaveURL(`${AUTH_URL}/backstage/set-up`);

  await page.getByLabel("Set-up code").fill("not the code at all, sorry");
  await page.getByLabel("Your name").fill(OWNER.name);
  await page.getByLabel("Choose a PIN").fill(PIN);
  await page.getByLabel("And once more").fill(PIN);
  await press(page, /create my login/i);
  await expect(page.getByText("That is not the set-up code")).toBeVisible();
  // What was typed is still there, apart from the secrets.
  await expect(page.getByLabel("Your name")).toHaveValue(OWNER.name);
  await expect(page.getByLabel("Choose a PIN")).toHaveValue("");

  // A PIN everybody tries first is turned down, and so is a slip of the thumb.
  await page.getByLabel("Set-up code").fill(SETUP_CODE);
  await page.getByLabel("Choose a PIN").fill("123456");
  await page.getByLabel("And once more").fill("123456");
  await press(page, /create my login/i);
  await expect(page.getByText(/too easy to guess/i)).toHaveCount(1);
  await expect(page.getByText("That is not the set-up code")).toHaveCount(0);

  await page.getByLabel("Set-up code").fill(SETUP_CODE);
  await page.getByLabel("Choose a PIN").fill(PIN);
  await page.getByLabel("And once more").fill("408173");
  await press(page, /create my login/i);
  await expect(page.getByText("Those two don't match")).toBeVisible();

  await page.getByLabel("Set-up code").fill(SETUP_CODE);
  await page.getByLabel("Choose a PIN").fill(PIN);
  await page.getByLabel("And once more").fill(PIN);
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

  // Nobody makes a second owner here. What is left of the page is where a
  // new PIN is set, and that takes the set-up code too.
  await page.goto(`${AUTH_URL}/backstage/set-up`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /set a new pin/i,
  );
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  await page.goto(`${AUTH_URL}/backstage/set-up?with=email`);
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  await expect(page.getByLabel(/email/i)).toHaveCount(0);
});

test("the PIN opens the door, a wrong one does not, and the set-up code sets a new one", async ({
  page,
}) => {
  // Nothing opens without it, and the page that was asked for is remembered.
  await page.goto(`${AUTH_URL}/backstage/settings/staff`);
  await expect(page).toHaveURL(/\/backstage\/sign-in\?next=/);
  await expect(page.getByLabel("PIN", { exact: true })).toBeVisible();
  // With nobody else on the team there is no other way in to offer.
  await expect(page.getByLabel("Email")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /email and password/i }),
  ).toHaveCount(0);
  await expectNoAxeViolations(page);

  await page.getByLabel("PIN", { exact: true }).fill("408138");
  await press(page, /sign in/i);
  await expect(page.locator("main [role=alert]")).toHaveText(
    "That PIN isn't right.",
  );
  await expect(page.getByLabel("PIN", { exact: true })).toHaveValue("");

  await page.getByLabel("PIN", { exact: true }).fill(PIN);
  await press(page, /sign in/i);
  await expect(page).toHaveURL(`${AUTH_URL}/backstage/settings/staff`);

  // The staff list says how this login comes in, and shows no address to
  // write to. It is not offered a password link: the door could not check one.
  const mine = page.getByRole("listitem").filter({ hasText: OWNER.name });
  await expect(mine.getByText("Comes in with the PIN")).toBeVisible();
  await expect(mine.getByText(/invalid/)).toHaveCount(0);
  await expect(
    mine.getByRole("button", { name: /new password link/i }),
  ).toHaveCount(0);
  // Nor is it switched off or turned down: the set-up code has to go on
  // having a PIN to set. It stops being a PIN login by being swapped.
  await expect(mine.getByRole("button", { name: /switch off/i })).toHaveCount(
    0,
  );
  await expect(mine.getByRole("combobox")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "You come in with a PIN" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  // The go-live list counts a PIN as not ready for real customers.
  await page.goto(`${AUTH_URL}/backstage/settings/go-live`);
  await expect(
    page.getByText(/The back end is opened with a PIN/),
  ).toBeVisible();
  await page.goto(`${AUTH_URL}/backstage/more`);
  await expect(page.getByText("Signed in with the PIN")).toBeVisible();

  // Forgotten, or locked out: the set-up code sets a new one.
  await signOut(page);
  await page.getByRole("link", { name: /forgot the pin/i }).click();
  await expect(page).toHaveURL(`${AUTH_URL}/backstage/set-up`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /set a new pin/i,
  );
  await expectNoAxeViolations(page);

  await page.getByLabel("Set-up code").fill("still not the code, sorry");
  await page.getByLabel("New PIN").fill(NEW_PIN);
  await page.getByLabel("And once more").fill(NEW_PIN);
  await press(page, /save and sign in/i);
  await expect(page.getByText("That is not the set-up code")).toBeVisible();

  await page.getByLabel("Set-up code").fill(SETUP_CODE);
  await page.getByLabel("New PIN").fill(NEW_PIN);
  await page.getByLabel("And once more").fill(NEW_PIN);
  await press(page, /save and sign in/i);
  // Straight in, and to the staff list: if the PIN was set again because
  // somebody else had it, this is where what they left behind would show.
  await expect(page).toHaveURL(/\/backstage\/settings\/staff\?/);
  await expect(page.locator("main [role=status]")).toHaveText(
    /New PIN saved.*Look down this list for anybody you do not know/,
  );

  // The old PIN is a wrong one now.
  await signOut(page);
  await page.getByLabel("PIN", { exact: true }).fill(PIN);
  await press(page, /sign in/i);
  await expect(page.locator("main [role=alert]")).toHaveText(
    "That PIN isn't right.",
  );
  await page.getByLabel("PIN", { exact: true }).fill(NEW_PIN);
  await press(page, /sign in/i);
  await expect(page).toHaveURL(`${AUTH_URL}/backstage`);

  await page.goto(`${AUTH_URL}/backstage/settings/activity`);
  await expect(
    page.getByText(
      `Set up the back end with ${OWNER.name} as its owner, coming in with a PIN`,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(`Set a new PIN for ${OWNER.name}, with the set-up code`),
  ).toBeVisible();
});

test("the PIN is swapped for an email and a password, and then it is gone", async ({
  page,
}) => {
  await page.goto(`${AUTH_URL}/backstage/sign-in`);
  await page.getByLabel("PIN", { exact: true }).fill(NEW_PIN);
  await press(page, /sign in/i);
  await expect(page).toHaveURL(`${AUTH_URL}/backstage`);

  await page.goto(`${AUTH_URL}/backstage/settings/staff`);
  // The PIN alone does not do it: the swap takes the set-up code, so
  // nobody who only knows the PIN can take the back end over.
  await page.getByLabel("Set-up code").fill("the PIN is all I have, sorry");
  await page.getByLabel("Your email").fill(OWNER.email);
  await page.getByLabel("Choose a password").fill(OWNER.password);
  await press(page, /make it my login/i);
  await expect(page.getByText("That is not the set-up code")).toBeVisible();
  // What was typed is still there, apart from the secrets.
  await expect(page.getByLabel("Your email")).toHaveValue(OWNER.email);
  await expect(page.getByLabel("Set-up code")).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "You come in with a PIN" }),
  ).toBeVisible();

  await page.getByLabel("Set-up code").fill(SETUP_CODE);
  await page.getByLabel("Choose a password").fill("short");
  await press(page, /make it my login/i);
  await expect(page.getByText(/^Use at least 12 characters/)).toHaveCount(1);
  await expect(page.getByText("That is not the set-up code")).toHaveCount(0);

  await page.getByLabel("Set-up code").fill(SETUP_CODE);
  await page.getByLabel("Choose a password").fill(OWNER.password);
  await press(page, /make it my login/i);
  await expect(page.locator("main [role=status]")).toHaveText(
    /you sign in with your email and password, and the PIN no longer works/i,
  );
  // Still signed in, as the same person, now under an address.
  const mine = page.getByRole("listitem").filter({ hasText: OWNER.name });
  await expect(mine.getByText(OWNER.email)).toBeVisible();
  await expect(mine.getByText("Comes in with the PIN")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "You come in with a PIN" }),
  ).toHaveCount(0);
  await page.goto(`${AUTH_URL}/backstage/settings/go-live`);
  await expect(
    page.getByText("Everybody signs in with their own email and password."),
  ).toBeVisible();

  // The door asks for an email and a password from here on. There is no
  // PIN to type, and the set-up page is gone for good.
  await signOut(page);
  await expect(page.getByLabel("PIN", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Email")).toBeVisible();
  await page.goto(`${AUTH_URL}/backstage/set-up`);
  await expect(page).toHaveURL(/\/backstage\/sign-in$/);

  await signIn(page, OWNER.email, OWNER.password);
  await expect(page).toHaveURL(`${AUTH_URL}/backstage`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ash");
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

test("a notice box only ever says the back end's own words", async ({
  page,
}) => {
  await signIn(page, OWNER.email, OWNER.password);
  const staff = `${AUTH_URL}/backstage/settings/staff`;

  // A link somebody made by hand, with a sentence of theirs in it. The
  // sentence is taken out of the address before the page is drawn.
  await page.goto(
    `${staff}?notice=Your%20session%20ended.%20Sign%20in%20again%20at%20evil.example&tone=bad`,
  );
  await expect(page).toHaveURL(staff);
  await expect(
    page.getByRole("heading", { level: 1, name: /staff/i }),
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText("evil.example");
  await expect(page.locator("main [role=alert]")).toHaveCount(0);

  // What the back end says itself still arrives, and is still there when
  // the page is loaded again.
  const mine = page.getByRole("listitem").filter({ hasText: OWNER.email });
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    mine.getByRole("button", { name: /switch off/i }).click(),
  ]);
  await expect(page.locator("main [role=alert]")).toHaveText(/no owner/i);
  const said = new URL(page.url());
  expect(said.searchParams.get("nsig")).toMatch(/^[a-f0-9]{32}$/);
  await page.reload();
  await expect(page.locator("main [role=alert]")).toHaveText(/no owner/i);

  // The same address with the sentence changed is somebody else's again.
  const changed = new URL(said);
  changed.searchParams.set("notice", "Now pay the invoice at evil.example");
  await page.goto(changed.toString());
  await expect(page).toHaveURL(staff);
  await expect(page.locator("main")).not.toContainText("evil.example");
  await expect(page.locator("main [role=alert]")).toHaveCount(0);

  // And it is only good for the page it was said on.
  const moved = new URL(said);
  moved.pathname = "/backstage/settings";
  await page.goto(moved.toString());
  await expect(page).toHaveURL(`${AUTH_URL}/backstage/settings`);
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
});

test("signing in never brings a stranger's sentence in with it", async ({
  page,
}) => {
  // The link to the sign-in page says where to go once signed in, and a
  // stranger can write that link. Signing in is a form: with scripting on,
  // its redirect sets the browser's address without the page being asked
  // for at that address, so nothing would take a sentence out of it. A
  // form on that page which is handed back and drawn again would then be
  // drawn from an address with a stranger's sentence in it.
  const forged = "Not saved. Ring 0800 000 000 to finish";
  const staff = `${AUTH_URL}/backstage/settings/staff`;
  const next = `/backstage/settings/staff?notice=${encodeURIComponent(forged)}&tone=bad`;
  await page.goto(
    `${AUTH_URL}/backstage/sign-in?next=${encodeURIComponent(next)}`,
  );
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await press(page, /sign in/i);

  // They land where they were going, and the address holds no sentence.
  await expect(
    page.getByRole("heading", { level: 1, name: /staff/i }),
  ).toBeVisible();
  await expect(page).toHaveURL(staff);
  await expect(page.locator("main")).not.toContainText("0800");

  // A form here that is handed back with what was typed has nothing of a
  // stranger's to be drawn with.
  await page.getByLabel("Name", { exact: true }).fill("Nobody");
  await page.getByLabel("Email", { exact: true }).fill("not an address");
  await press(page, /^invite$/i);
  await expect(page).toHaveURL(staff);
  await expect(page.locator("main")).not.toContainText("0800");

  // The rest of a return address is kept: it is only the sentence that goes.
  const outside = await page.context().browser()?.newContext();
  if (outside === undefined) throw new Error("no browser to open");
  const other = await outside.newPage();
  await other.goto(
    `${AUTH_URL}/backstage/sign-in?next=${encodeURIComponent(`/backstage/orders?status=packed&notice=${encodeURIComponent(forged)}`)}`,
  );
  await other.getByLabel("Email").fill(OWNER.email);
  await other.getByLabel("Password").fill(OWNER.password);
  await press(other, /sign in/i);
  await expect(other).toHaveURL(`${AUTH_URL}/backstage/orders?status=packed`);
  await outside.close();
});

/* ------------------------------------------------------------------------
   The line across the top of the shop.

   Every visitor to the shop reads it, on every page, so it is changed here,
   on the server whose shop no other test looks at.
   --------------------------------------------------------------------- */

test("the line across the top is drafted, previewed, published and put back", async ({
  page,
  browser,
}) => {
  const editor = `${AUTH_URL}/backstage/marketing/pages/top-line`;
  const SITES_OWN = "Never fear, Lucky is here";
  const MINE = "Batch 002 is in";
  const words = page.getByLabel("One line to a row");
  /** The band across the top of a page of the shop. */
  const band = (shop: Page) => shop.locator("[data-marquee]").first();

  // A customer, on a screen as wide as they come: nobody signed in.
  const outside = await browser.newContext({
    viewport: { width: 3840, height: 900 },
  });
  const customer = await outside.newPage();
  /** Load the shop afresh until its band says, or stops saying, a line. */
  const shopSays = async (line: string, says = true) => {
    await expect(async () => {
      await customer.goto(AUTH_URL);
      if (says) await expect(band(customer)).toContainText(line);
      else await expect(band(customer)).not.toContainText(line);
    }).toPass({ timeout: 30_000 });
  };
  /** How far the band's words reach, against how far they have to. */
  const reach = () =>
    band(customer).evaluate((element) => ({
      words: element.firstElementChild?.scrollWidth ?? 0,
      // The words slide by half their width, so they have to be twice
      // as wide as the screen for the band never to show a gap.
      needed: 2 * window.innerWidth,
    }));

  await shopSays(SITES_OWN);
  const sitesOwn = await reach();
  expect(sitesOwn.words).toBeGreaterThanOrEqual(sitesOwn.needed);

  await signIn(page, OWNER.email, OWNER.password);
  await page.goto(editor);
  await expect(page.locator("main")).toContainText(
    "The shop is showing its standard line.",
  );
  await expect(words).toHaveValue(/^Tiny package, big dill\n/);

  // A draft changes nothing a customer sees.
  await words.fill(`${MINE}\n\n  Lucky   you've got us  `);
  await press(page, /save the draft/i);
  await expect(page.locator("main [role=status]")).toHaveText(
    "Draft saved. Nothing a customer sees has changed.",
  );
  // Tidied as it was saved: a row to a line, and the empty row gone.
  await expect(words).toHaveValue(`${MINE}\nLucky you've got us`);
  await shopSays(SITES_OWN);
  await expect(band(customer)).not.toContainText(MINE);

  // The preview beside it is the real page with the draft across the top,
  // and says that it is a preview.
  const preview = page.frameLocator('iframe[title^="The shop with the draft"]');
  await expect(preview.locator("[data-marquee]").first()).toContainText(MINE);
  await expect(preview.getByTestId("preview-ribbon")).toContainText(
    "The draft of \u201cThe line across the top\u201d. Customers cannot see this.",
  );
  // Somebody who is not signed in cannot look at a draft.
  await customer.goto(`${AUTH_URL}/preview/home?line=draft`);
  await expect(customer).toHaveURL(/\/backstage\/sign-in/);

  // Publishing is for the words on the screen, and the shop follows.
  await expect(page.locator("#publish")).toContainText(
    "These words will go across the top:",
  );
  await press(page, /publish this line/i);
  await expect(page.locator("main [role=status]")).toHaveText(
    "Published. The shop shows it within a minute.",
  );
  await expect(page.locator("main")).toContainText(
    "The shop is showing the line you published.",
  );
  await shopSays(MINE);
  await expect(band(customer)).not.toContainText(SITES_OWN);
  // Two short lines still reach right across a wide screen.
  const mine = await reach();
  expect(mine.words).toBeGreaterThanOrEqual(mine.needed);
  // And a screen reader is read them once, not once for each time round.
  await expect(
    band(customer).locator("ul:not([aria-hidden])").getByText(MINE),
  ).toHaveCount(1);

  // Wording the copy rules stop is kept as a draft and cannot be published.
  /* copy-audit-ignore-start: a claim typed on purpose, to see it stopped */
  await words.fill("No more cramps in the second half");
  /* copy-audit-ignore-end */
  await press(page, /save the draft/i);
  await expect(page.locator("main [role=status]")).toHaveText(
    "Draft saved. The copy check found wording that cannot be published.",
  );
  await expect(page.locator("#publish")).toContainText(
    "This draft cannot be published as written.",
  );
  await expect(
    page.getByRole("button", { name: /publish this line/i }),
  ).toHaveCount(0);
  await shopSays(MINE);

  // One press puts the site's own line back. A draft being worked on stays.
  await press(page, /put the standard line back/i);
  await expect(page.locator("main [role=status]")).toHaveText(
    "The standard line is back, and shows within a minute. Your words are kept as the draft.",
  );
  await shopSays(SITES_OWN);
  await expect(band(customer)).not.toContainText(MINE);

  // Left as it was found: an empty box is no draft at all.
  await words.fill("");
  await press(page, /save the draft/i);
  await expect(page.locator("main [role=status]")).toHaveText(
    "The draft is what the shop shows, so there is nothing to publish.",
  );
  await expect(words).toHaveValue(/^Tiny package, big dill\n/);
  await outside.close();
});

/* ------------------------------------------------------------------------
   The shop's settings.

   These change what the shop charges, so they run here, on the server
   whose shop no other test buys from: on the first server a moved price
   would move every other test's total.
   --------------------------------------------------------------------- */

/** Change the shop: set the form, read the change back, then make it. */
async function changeTheShop(
  page: Page,
  set: (page: Page) => Promise<void>,
  says: RegExp,
) {
  await page.goto(`${AUTH_URL}/backstage/settings/shop`);
  await set(page);
  await press(page, /see what changes/i);
  await expect(page.getByTestId("shop-checked")).toContainText(says);
  await press(page, /change the shop/i);
  await expect(page.getByTestId("shop-done")).toContainText(says);
}

/** A customer with The Trial in the jar, at the checkout, form filled in. */
async function atCheckoutWithTheTrial(customer: Page) {
  await customer.goto(`${AUTH_URL}/`);
  await customer.locator("#shop").scrollIntoViewIfNeeded();
  await customer.getByText("The Trial", { exact: true }).click();
  await customer.getByTestId("add-to-jar").click();
  const jar = customer.getByRole("dialog");
  await jar.getByRole("link", { name: /checkout/i }).click();
  await expect(customer).toHaveURL(/\/checkout$/);
  await customer.fill("#co-email", "mere@example.co.nz");
  await customer.fill("#co-firstName", "Mere");
  await customer.fill("#co-lastName", "Tane");
  await customer.fill("#co-line1", "4 Halfway Line");
  await customer.fill("#co-city", "Levin");
  await customer.selectOption("#co-region", "Manawatū-Whanganui");
  await customer.fill("#co-postcode", "5510");
}

test("the shop's settings read a change back before making it, and the shop follows", async ({
  page,
  browser,
}) => {
  await signIn(page, OWNER.email, OWNER.password);
  const price = "The Trial (6 shots)";

  // The first press saves nothing.
  await page.goto(`${AUTH_URL}/backstage/settings/shop`);
  await expect(page.getByLabel(price)).toHaveValue("27.00");
  await page.getByLabel(price).fill("30");
  await press(page, /see what changes/i);
  await expect(page.getByTestId("shop-checked")).toContainText(
    "The Trial from $27 to $30",
  );
  const other = await browser.newContext();
  const customer = await other.newPage();
  await customer.goto(`${AUTH_URL}/`);
  await customer.getByText("The Trial", { exact: true }).click();
  await expect(customer.getByTestId("add-to-jar")).toContainText("$27");

  // The second makes exactly that change.
  await press(page, /change the shop/i);
  await expect(page.getByTestId("shop-done")).toContainText(
    "The Trial from $27 to $30",
  );
  await page.reload();
  await expect(page.getByLabel(price)).toHaveValue("30.00");
  await expect(page.getByTestId("shop-moved")).toContainText(
    "The Trial from $27 to $30",
  );

  // The kept page was thrown away: the next visitor is shown the new price,
  // and is charged it.
  await expect(async () => {
    await customer.goto(`${AUTH_URL}/`);
    await customer.getByText("The Trial", { exact: true }).click();
    await expect(customer.getByTestId("add-to-jar")).toContainText("$30", {
      timeout: 2000,
    });
  }).toPass({ timeout: 20_000 });
  await atCheckoutWithTheTrial(customer);
  const place = customer.getByTestId("place-order");
  await expect(place).toContainText("$37.00");
  await place.click();
  await expect(customer).toHaveURL(/\/order\/thanks$/);
  await expect(customer.getByText("$37.00")).toBeVisible();
  await other.close();

  // A slip is refused in words, with nothing saved.
  await page.getByLabel(price).fill("0.50");
  await press(page, /see what changes/i);
  await expect(page.locator("main [role=alert]")).toContainText(
    /a pack costs between \$1 and \$1,000/i,
  );
  await page.getByLabel(price).fill("60");
  await press(page, /see what changes/i);
  await expect(page.locator("main [role=alert]")).toContainText(
    /would cost no more than the trial/i,
  );
});

test("a buyer part-way through the checkout is shown the new total before they can pay", async ({
  page,
  browser,
}) => {
  const other = await browser.newContext();
  const customer = await other.newPage();
  await atCheckoutWithTheTrial(customer);
  const place = customer.getByTestId("place-order");
  await expect(place).toContainText("$37.00");

  // The price moves while their page still says $37.
  await signIn(page, OWNER.email, OWNER.password);
  await changeTheShop(
    page,
    (shop) => shop.getByLabel("The Trial (6 shots)").fill("32"),
    /The Trial from \$30 to \$32/,
  );

  // Pressing the button places nothing. They are told, and shown $39.
  await place.click();
  await expect(customer.locator("main [role=alert]")).toContainText(
    /changed while you were checking out/i,
  );
  await expect(customer).toHaveURL(/\/checkout$/);
  await expect(place).toContainText("$39.00");
  // What they had typed is still there, the region they picked included.
  await expect(customer.locator("#co-email")).toHaveValue("mere@example.co.nz");
  await expect(customer.locator("#co-region")).toHaveValue(
    "Manawatū-Whanganui",
  );

  // Pressing again, on the total they can now see, goes through at it.
  await place.click();
  await expect(customer).toHaveURL(/\/order\/thanks$/);
  await expect(customer.getByText("$39.00")).toBeVisible();
  await other.close();
});

test("the shop can be stopped, says so everywhere, and can be started again", async ({
  page,
  browser,
}) => {
  // Somebody already at the checkout when it stops.
  const other = await browser.newContext();
  const customer = await other.newPage();
  await atCheckoutWithTheTrial(customer);

  await signIn(page, OWNER.email, OWNER.password);
  await changeTheShop(
    page,
    (shop) => shop.getByRole("radio", { name: /no, stop for now/i }).check(),
    /not taking orders/i,
  );
  // Today says so, so nobody forgets it is off.
  await page.goto(`${AUTH_URL}/backstage`);
  await expect(
    page.getByText("The shop is not taking orders").first(),
  ).toBeVisible();

  // Their order is not taken, and nothing is charged.
  await customer.getByTestId("place-order").click();
  await expect(customer.locator("main [role=alert]")).toContainText(
    /not taking orders right now, so nothing was charged/i,
  );
  await expect(customer.getByTestId("place-order")).toBeDisabled();
  await expect(customer.getByTestId("checkout-closed")).toBeVisible();

  // The page says it too, and points at the Pickle Crew.
  await expect(async () => {
    await customer.goto(`${AUTH_URL}/`);
    await expect(customer.getByTestId("shop-closed")).toBeVisible({
      timeout: 2000,
    });
  }).toPass({ timeout: 20_000 });
  await expect(customer.getByTestId("add-to-jar")).toBeDisabled();
  await expect(customer.getByTestId("add-to-jar")).toContainText(
    /not taking orders/i,
  );
  // On a phone the button's words fit inside it.
  await customer.setViewportSize({ width: 390, height: 844 });
  const fits = await customer.getByTestId("add-to-jar").evaluate((button) => {
    const label = button.querySelector("span");
    if (label === null) return false;
    const outer = button.getBoundingClientRect();
    const inner = label.getBoundingClientRect();
    return inner.left >= outer.left && inner.right <= outer.right;
  });
  expect(fits).toBe(true);
  await expect(
    customer.getByRole("link", { name: /join the pickle crew/i }).first(),
  ).toHaveAttribute("href", "#crew");
  // Nothing on a shut shop fails the accessibility rules. (Scanned once the
  // page has finished fading in, like every other page: e2e/a11y.spec.ts.)
  await customer.waitForTimeout(900);
  const results = await new AxeBuilder({ page: customer })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    ),
  ).toEqual([]);

  // Started again, at the catalogue's own price, for whoever runs next.
  await changeTheShop(
    page,
    async (shop) => {
      await shop.getByRole("radio", { name: /yes, taking orders/i }).check();
      await shop.getByLabel("The Trial (6 shots)").fill("27");
    },
    /taking orders again/i,
  );
  await expect(async () => {
    await customer.goto(`${AUTH_URL}/`);
    await customer.getByText("The Trial", { exact: true }).click();
    await expect(customer.getByTestId("add-to-jar")).toContainText("$27", {
      timeout: 2000,
    });
  }).toPass({ timeout: 20_000 });
  await other.close();
});

test("an owner says a fact is right on the go-live list, and can take it back", async ({
  page,
}) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto(`${AUTH_URL}/backstage/settings/go-live`);
  const packs = page.getByTestId("fact-packs");
  // What is being confirmed is spelled out beside the button.
  await expect(packs).toContainText("The Trial: 6 shots, $27");
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    packs.getByRole("button", { name: /this is right/i }).click(),
  ]);
  await expect(page.locator("main [role=status]").first()).toHaveText(
    /confirmed/i,
  );
  await expect(packs).toContainText(`Confirmed by ${OWNER.name}`);

  // A fact whose words are not in yet cannot be settled, and says so.
  const ingredients = page.getByTestId("fact-ingredients");
  await expect(ingredients).toContainText(/put the ingredients list in first/i);
  await expect(ingredients.getByRole("button")).toHaveCount(0);
  // And one that needs its figure first says so.
  await expect(page.getByTestId("fact-ship-date")).toContainText(
    /set the ship date first/i,
  );

  // Others are still open, so the shop is still closed to search engines.
  await page.goto(`${AUTH_URL}/`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );

  await page.goto(`${AUTH_URL}/backstage/settings/go-live`);
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page
      .getByTestId("fact-packs")
      .getByRole("button", { name: /not right after all/i })
      .click(),
  ]);
  await expect(page.getByTestId("fact-packs")).toContainText("Ask:");
});

test("what the label says is typed with the label in hand, checked, and shown on the shop", async ({
  page,
}) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto(`${AUTH_URL}/backstage/settings/label`);
  const list = page.getByLabel("The ingredients list");

  // A claim is refused in the rules' own words, with nothing saved.
  await list.fill("Water, salt, electrolytes");
  await press(page, /see what changes/i);
  await expect(page.locator("main [role=alert]")).toContainText(
    /cannot go out/i,
  );
  await expect(page.getByTestId("label-tick")).toHaveCount(0);

  // A word the Food Standards Code puts on a label itself waits for a
  // person to say the printed label has it.
  await list.fill("Water, vinegar, salt, mineral salt (509)");
  await page.getByLabel("The storage line").fill("Refrigerate after opening");
  await press(page, /see what changes/i);
  await expect(page.locator("main [role=alert]")).toContainText(
    /check this against the printed label/i,
  );
  await page.getByTestId("label-tick").getByRole("checkbox").check();
  await press(page, /see what changes/i);
  await expect(page.getByTestId("label-checked")).toContainText(
    'The ingredients list to "Water, vinegar, salt, mineral salt (509)"',
  );

  // The tick is for those words. Change one and it is asked for again.
  await list.fill("Water, vinegar, salt, mineral salts (509, 508)");
  await press(page, /change the site/i);
  await expect(page.locator("main [role=alert]")).toContainText(
    /check this against the printed label/i,
  );
  await expect(
    page.getByTestId("label-tick").getByRole("checkbox"),
  ).not.toBeChecked();

  // Back to what the label says. The tick was for other words, so it is
  // asked for once more, for these.
  await list.fill("Water, vinegar, salt, mineral salt (509)");
  await press(page, /see what changes/i);
  await expect(
    page.getByTestId("label-tick").getByRole("checkbox"),
  ).not.toBeChecked();
  await page.getByTestId("label-tick").getByRole("checkbox").check();
  await press(page, /see what changes/i);
  await expect(page.getByTestId("label-checked")).toBeVisible();
  await press(page, /change the site/i);
  await expect(page.getByTestId("label-done")).toContainText(
    'The storage line to "Refrigerate after opening"',
  );

  // The shop says exactly that, under its own question, and adds nothing.
  await expect(async () => {
    await page.goto(`${AUTH_URL}/`);
    await expect(page.locator("#faq")).toContainText(
      "Water, vinegar, salt, mineral salt (509).",
      { timeout: 2000 },
    );
  }).toPass({ timeout: 20_000 });
  await expect(page.locator("#faq")).toContainText(
    "Refrigerate after opening.",
  );

  // Who is behind the shop. A slipped digit is caught before it is saved.
  await page.goto(`${AUTH_URL}/backstage/settings/label`);
  await expect(list).toHaveValue("Water, vinegar, salt, mineral salt (509)");
  await page.getByLabel("The legal name").fill("Quick Pickle Limited");
  await page.getByLabel("NZBN").fill("9429040402544");
  await press(page, /see what changes/i);
  await expect(page.locator("main [role=alert]")).toContainText(
    /not a New Zealand Business Number/i,
  );
  await page.getByLabel("NZBN").fill("94 2904 0402 543");
  await page.getByLabel("Registered for GST").selectOption("yes");
  await page.getByLabel("GST number").fill("49-091-850");
  await press(page, /see what changes/i);
  await expect(page.getByTestId("label-checked")).toContainText(
    "The GST number to 49-091-850",
  );
  await press(page, /change the site/i);
  await expect(page.getByTestId("label-done")).toContainText(
    "The NZBN to 9429040402543",
  );

  // The terms of sale name the seller, and say prices include GST.
  await expect(async () => {
    await page.goto(`${AUTH_URL}/terms`);
    await expect(page.locator("main")).toContainText(
      "Quick Pickle is sold by Quick Pickle Limited (NZBN 9429040402543).",
      { timeout: 2000 },
    );
  }).toPass({ timeout: 20_000 });
  await expect(page.locator("main")).toContainText(
    "Our GST number is 49-091-850.",
  );
  await expect(page.locator("main")).toContainText("and include GST");

  // Putting the words in did not confirm them: an owner still says each is
  // right, and is shown exactly what they are saying is right.
  await page.goto(`${AUTH_URL}/backstage/settings/go-live`);
  const label = page.getByTestId("fact-ingredients");
  await expect(label).toContainText(
    "Ingredients: Water, vinegar, salt, mineral salt (509)",
  );
  await expect(
    label.getByRole("button", { name: /this is right/i }),
  ).toBeVisible();
  await expect(page.getByTestId("fact-legal-entity")).toContainText(
    "Quick Pickle Limited, NZBN 9429040402543; registered for GST, number 49-091-850",
  );
});

/** Where the app in the next test asks to be sent back to: this computer. */
const APP_CALLBACK = "http://localhost:53999/callback";

/** What an app keeps between the steps of connecting. */
class AppMemory implements OAuthClientProvider {
  client: unknown;
  kept: unknown;
  verifier = "";
  /** Where the app tried to send the person to say yes. */
  sentTo: URL | null = null;

  readonly redirectUrl = APP_CALLBACK;
  readonly clientMetadata = {
    client_name: "Claude Code",
    redirect_uris: [APP_CALLBACK],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
  clientInformation() {
    return this.client as never;
  }
  saveClientInformation(client: unknown) {
    this.client = client;
  }
  tokens() {
    return this.kept as never;
  }
  saveTokens(tokens: unknown) {
    this.kept = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.sentTo = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
}

/** What a tool handed back, read out of its one block of text. */
function answered(result: { content?: unknown }): unknown {
  const [first] = (result.content ?? []) as { text?: string }[];
  return JSON.parse(first?.text ?? "null");
}

test("Claude is let in by a person's yes, asks before anything outward, and can be cut off", async ({
  page,
  browser,
}) => {
  const address = `${AUTH_URL}/api/mcp`;
  const documents = `${AUTH_URL}/.well-known/oauth-authorization-server`;
  await signIn(page, OWNER.email, OWNER.password);

  // It ships switched off: there is nothing there to find.
  expect((await page.request.get(documents)).status()).toBe(404);
  expect((await page.request.post(address, { data: {} })).status()).toBe(404);
  // To any verb. Left to itself the server answers 405 to a verb with no
  // handler, and 204 to OPTIONS, and either says there is a door here.
  for (const path of [
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/api/oauth/register",
    "/api/oauth/token",
    "/api/mcp",
  ]) {
    for (const method of ["OPTIONS", "HEAD", "PUT", "DELETE"]) {
      const answer = await page.request.fetch(`${AUTH_URL}${path}`, {
        method,
      });
      expect(answer.status(), `${method} ${path}`).toBe(404);
      expect(answer.headers().allow, `${method} ${path}`).toBeUndefined();
    }
  }

  // An owner switches it on, and is given the address to hand to Claude.
  await page.goto(`${AUTH_URL}/backstage/settings/claude`);
  await press(page, /let claude be connected/i);
  await expect(page.locator("main [role=status]").first()).toContainText(
    /claude can be connected now/i,
  );
  await expect(page.getByLabel("The address to give Claude")).toHaveValue(
    address,
  );
  expect((await page.request.get(documents)).status()).toBe(200);
  expect((await page.request.post(address, { data: {} })).status()).toBe(401);

  // An app starts connecting. It is the protocol's own client library, the
  // thing an app like Claude Code is built on, talking to the real server.
  const app = new AppMemory();
  const reach = () =>
    new StreamableHTTPClientTransport(new URL(address), { authProvider: app });
  const first = reach();
  await expect(
    new Client({ name: "claude-code", version: "1.0.0" }).connect(first),
  ).rejects.toThrow();
  const consent = app.sentTo;
  if (consent === null) throw new Error("The app sent nobody anywhere.");
  expect(`${consent.origin}${consent.pathname}`).toBe(
    `${AUTH_URL}/backstage/connect`,
  );

  // It sends the person to the consent screen, which says what is asking,
  // where the answer goes, and what it will be able to do.
  await page.route(`${APP_CALLBACK}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "Back at the app.",
    }),
  );
  // Somebody who is not signed in is asked to sign in first, and lands back
  // on the same request, with nothing lost.
  const stranger = await browser.newContext();
  const visitor = await stranger.newPage();
  await visitor.goto(consent.toString());
  await expect(visitor).toHaveURL(/\/backstage\/sign-in\?next=/);
  await visitor.getByLabel("Email").fill(OWNER.email);
  await visitor.getByLabel("Password").fill(OWNER.password);
  await press(visitor, /sign in/i);
  await expect(visitor).toHaveURL(/\/backstage\/connect\?/);
  await expect(visitor.locator("main")).toContainText(
    'calls itself "Claude Code"',
  );
  // Saying no sends them back to the app with a plain refusal and no code.
  await visitor.route(`${APP_CALLBACK}**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", body: "No." }),
  );
  await Promise.all([
    visitor.waitForURL((url) => url.toString().startsWith(APP_CALLBACK)),
    visitor.getByRole("button", { name: /no, do not connect/i }).click(),
  ]);
  const refusedAt = new URL(visitor.url());
  expect(refusedAt.searchParams.get("error")).toBe("access_denied");
  expect(refusedAt.searchParams.get("code")).toBeNull();
  expect(refusedAt.searchParams.get("state")).toBe(
    consent.searchParams.get("state"),
  );
  await stranger.close();

  // A request with anything out of place is refused on the page itself:
  // nobody is sent on to an address that was not checked.
  const tampered = new URL(consent.toString());
  tampered.searchParams.set("redirect_uri", "https://evil.example/callback");
  await page.goto(tampered.toString());
  await expect(page.locator("main [role=alert]")).toContainText(
    /somewhere it did not register/i,
  );
  await expect(page.getByRole("button", { name: "Connect" })).toHaveCount(0);

  await page.goto(consent.toString());
  await expect(
    page.getByRole("heading", { name: "Connect Claude" }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText(
    'calls itself "Claude Code"',
  );
  await expect(page.getByTestId("connect-back-to")).toContainText(
    "an app on this computer",
  );
  await expect(page.locator("main")).toContainText(
    "customers' names, addresses, emails and orders",
  );
  await page.getByLabel(/look and make changes/i).check();
  await Promise.all([
    page.waitForURL((url) => url.toString().startsWith(APP_CALLBACK)),
    page.getByRole("button", { name: "Connect", exact: true }).click(),
  ]);
  const back = new URL(page.url());
  expect(back.searchParams.get("iss")).toBe(AUTH_URL);
  expect(back.searchParams.get("code")).toMatch(/^qpc_/);

  // The app swaps its code for keys, and is handed three tools.
  await first.finishAuth(back.searchParams);
  const claude = new Client({ name: "claude-code", version: "1.0.0" });
  await claude.connect(reach());
  expect((await claude.listTools()).tools.map((tool) => tool.name)).toEqual([
    "find",
    "look",
    "change",
  ]);

  // An ordinary change is made, under the bot's own name.
  const task = "Ring the label printer";
  await claude.callTool({
    name: "change",
    arguments: { calls: [{ op: "plans.addTask", input: { title: task } }] },
  });
  await page.goto(`${AUTH_URL}/backstage/settings/activity`);
  await expect(page.locator("main")).toContainText(`Added a task: ${task}`);
  await expect(page.locator("main")).toContainText(`Claude, for ${OWNER.name}`);

  // Anything a customer would see is not done. It waits for a yes.
  const asked = answered(
    await claude.callTool({
      name: "change",
      arguments: {
        calls: [{ op: "shop.change", input: { batchName: "Batch 002" } }],
      },
    }),
  ) as {
    outcomes: { waitingForAPerson: { approval: string; decideAt: string } }[];
  };
  const waiting = asked.outcomes[0]?.waitingForAPerson;
  expect(waiting?.decideAt).toBe(
    `${AUTH_URL}/backstage/approvals/${waiting?.approval ?? ""}`,
  );
  await page.goto(`${AUTH_URL}/backstage/settings/shop`);
  await expect(page.getByLabel("What this batch is called")).toHaveValue(
    "Batch 001",
  );

  // It is on Today, and its page says exactly what would happen.
  await page.goto(`${AUTH_URL}/backstage`);
  await expect(page.locator("main")).toContainText(
    `Claude, for ${OWNER.name} is waiting for your yes on one thing`,
  );
  await page.goto(waiting?.decideAt ?? "");
  await expect(page.getByTestId("approval-says")).toContainText(
    "changes what every customer sees",
  );
  await expect(page.getByTestId("approval-input")).toContainText("Batch 002");
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(audit.violations).toEqual([]);

  // A person, signed in, says yes. Then it is done, and the bot can see so.
  await press(page, /yes, do it/i);
  await expect(page.locator("main [role=status]").first()).toHaveText(/done/i);
  // What came back is said as words, with the rest folded away.
  await expect(page.getByTestId("approval-result")).toContainText(
    'the batch\'s name to "Batch 002"',
  );
  const seen = answered(
    await claude.callTool({
      name: "look",
      arguments: {
        calls: [{ op: "approvals.get", input: { id: waiting?.approval } }],
      },
    }),
  ) as { outcomes: { result: { status: string } }[] };
  expect(seen.outcomes[0]?.result.status).toBe("done");
  await page.goto(`${AUTH_URL}/backstage/settings/shop`);
  await expect(page.getByLabel("What this batch is called")).toHaveValue(
    "Batch 002",
  );

  // Cut off, it is shut out at once.
  await page.goto(`${AUTH_URL}/backstage/settings/claude`);
  await expect(page.getByTestId("connections")).toContainText(
    "Claude Code, for you",
  );
  await press(page, /^cut off$/i);
  await expect(page.locator("main [role=status]").first()).toContainText(
    /cut off/i,
  );
  await expect(
    claude.callTool({
      name: "look",
      arguments: { calls: [{ op: "shop.offer" }] },
    }),
  ).rejects.toThrow();

  // And switched off again, there is nothing there once more.
  await press(page, /stop claude connecting/i);
  expect((await page.request.get(documents)).status()).toBe(404);
  await claude.close().catch(() => undefined);
});
