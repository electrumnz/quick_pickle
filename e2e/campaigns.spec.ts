import { expect, test, type Page } from "@playwright/test";

/**
 * Emailing the Pickle Crew, in the back end. This server runs on invented
 * records, so a campaign goes the whole way (written, approved, queued,
 * worked through by the mail system) and nothing is ever sent: each email is
 * written down as not sent, and the screens have to say so.
 *
 * What a real send does with a mail provider is in the unit tests, where the
 * provider is a function (tests/backstage/campaign-delivery.test.ts).
 */

const LIST = "/backstage/marketing/campaigns";

/** A name of this test's own, on whichever size it is running at. */
const mine = (what: string, project: string) =>
  `${what} ${project} ${String(Date.now())}`;

/** One of a screen's panels, by the heading on it. */
const panel = (page: Page, title: string) =>
  page
    .locator("section.bk-panel")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });

/**
 * Press a form's button and wait for the answer to land: the reply itself,
 * and then for the button to stop saying it is busy. React clears a form as
 * its action returns, so nothing is typed or read until then.
 */
async function press(page: Page, name: string | RegExp): Promise<void> {
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page.getByRole("button", { name }).click(),
  ]);
  await page.waitForFunction(
    () => document.querySelector('button[aria-disabled="true"]') === null,
  );
}

test("a campaign is written, approved and sent, and says nothing left on invented records", async ({
  page,
}, testInfo) => {
  const title = mine("Batch news", testInfo.project.name);
  await page.goto(`${LIST}/new`);
  await page.getByLabel("Working title").fill(title);
  await page.getByLabel("Subject").fill("Batch 002 is in");
  await page.getByLabel("What it says").fill("Hi {{name}},\n\nTiny bottle.");
  await press(page, "Save the draft");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.locator("main")).toContainText("Saved.");

  // As it will read, with the lines that are added to every one of them.
  const preview = panel(page, "How it will read");
  await expect(preview).toContainText("Hi Sam,");
  await expect(preview).toContainText(
    "You are getting this because you joined the Pickle Crew.",
  );
  await expect(preview).toContainText("Had enough? Unsubscribe here");

  await press(page, "Approve it");
  await expect(page.locator("main")).toContainText(
    "Approved. It can be sent or given a time now.",
  );
  // It says where this place stands before anything is pressed.
  await expect(page.locator("main")).toContainText(
    "This back end is on invented records, so nothing is sent",
  );
  // A timed send is on, and says when it starts.
  await expect(page.locator("main")).toContainText(
    "starts within a few minutes of the time you set",
  );

  // The list can change under a test that runs beside others joining it.
  // Then the send is refused, the page is opened afresh with the new count
  // on its button, and the button is pressed again.
  const send = /^Send to \d+ (people|person) now$/;
  const here = page.url().split("?")[0] ?? "";
  const main = page.locator("main");
  for (let tries = 0; tries < 6; tries += 1) {
    await press(page, send);
    await expect(main).toContainText(
      /Queued for \d+ pe|The list has changed since you looked/,
    );
    if (await main.getByText(/Queued for \d+ pe/).isVisible()) break;
    await page.goto(here);
  }
  await expect(main).toContainText(/Queued for \d+ pe/);
  await expect(page.locator("main")).toContainText(
    "each email is written down as not sent",
  );

  // The mail system works through the queue after the press. Nothing went,
  // nobody is left waiting, and every one of them says why.
  await expect(async () => {
    await page.reload();
    await expect(page.locator("main")).toContainText(
      /Finished[^.]*: 0 sent, \d+ not delivered\./,
    );
  }).toPass({ timeout: 30_000 });
  const went = panel(page, "Who it went to");
  await expect(went).toContainText("invented records");
  // Nothing more can be done with it: no button offers to send again.
  await expect(page.getByRole("button", { name: send })).toHaveCount(0);
});

test("somebody who asked some other way is taken off the list", async ({
  page,
}, testInfo) => {
  const email = `leaver-${testInfo.project.name}-${String(Date.now())}@example.co.nz`;
  // They joined from the shop, like anybody.
  await page.goto("/");
  const crew = page.getByRole("textbox", { name: "Email address" });
  await crew.scrollIntoViewIfNeeded();
  await crew.fill(email);
  await page.getByRole("button", { name: "I'm in" }).click();
  await expect(page.getByText("You're in. Welcome to the crew.")).toBeVisible();

  // And then wrote in to say they had had enough.
  await page.goto(LIST);
  await page.getByText("Somebody asked to come off the list").click();
  await page.getByLabel("Their email address").fill(email);
  await press(page, "Take them off the list");
  await expect(page.locator("main")).toContainText(
    `${email} is off the Pickle Crew list.`,
  );

  // An address that was never on it is said plainly, and nothing is changed.
  const stranger = `never-${testInfo.project.name}-${String(Date.now())}@example.co.nz`;
  await page.getByText("Somebody asked to come off the list").click();
  await page.getByLabel("Their email address").fill(stranger);
  await press(page, "Take them off the list");
  await expect(page.locator("main")).toContainText(
    `${stranger} is not on the Pickle Crew list`,
  );
});
