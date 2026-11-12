import { expect, test, type Page } from "@playwright/test";

/**
 * The inbox, as a person uses it.
 *
 * This server has no database and no mail provider: its conversations are
 * the demo's, nothing arrives and nothing is sent. What is held here is that
 * the screens are wired to the operations behind them, that an email's own
 * HTML is never drawn, and that a reply meets the copy rules before it is
 * written down.
 *
 * Both sizes of screen share the one server and the one inbox. The tests
 * that only look run at both. The ones that change a conversation run at
 * one size, one after another, so that no two of them are ever part-way
 * through the same conversation.
 */

/** Open a conversation the way a person would: find it, then press it. */
async function open(page: Page, find: string, subject: string): Promise<void> {
  await page.goto(`/backstage/inbox?pile=all&q=${encodeURIComponent(find)}`);
  await page
    .getByTestId("conversations")
    .getByRole("link", { name: subject })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: subject }),
  ).toBeVisible();
}

/** The line a page says after a button was pressed. */
const said = (page: Page, text: string | RegExp) =>
  page
    .locator("main [role=status], main [role=alert]")
    .filter({ hasText: text });

const messages = (page: Page) => page.getByTestId("messages").locator("> li");

test("the inbox is on the menu, and lists what is waiting pile by pile", async ({
  page,
}) => {
  await page.goto("/backstage");
  await page
    .getByRole("navigation", { name: "Back end" })
    .getByRole("link", { name: /^Inbox/ })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Inbox" }),
  ).toBeVisible();
  await expect(page.getByText(/waiting on a reply/)).toBeVisible();

  // The pile that needs somebody is the one it opens on.
  const rows = page.getByTestId("conversations");
  await expect(
    page
      .getByRole("navigation", { name: "Piles" })
      .getByRole("link", { name: /^Needs a reply/ }),
  ).toHaveAttribute("aria-current", "page");
  await expect(rows).toContainText("Where is my order?");
  await expect(rows).toContainText("Liam Carter");
  // What a machine sent is not in it.
  await expect(rows).not.toContainText("is on its way");

  await page
    .getByRole("navigation", { name: "Piles" })
    .getByRole("link", { name: "Notices" })
    .click();
  await expect(rows).toContainText("Your parcel LZ8011558011NZ is on its way");
  await expect(rows).not.toContainText("Where is my order?");

  await page
    .getByRole("navigation", { name: "Piles" })
    .getByRole("link", { name: "Spam" })
    .click();
  await expect(rows).toContainText("A new website for half the price");

  // An order number finds the conversations about that order.
  await page.goto("/backstage/inbox");
  await page.getByLabel("Find a conversation").fill("qp-sent66");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(rows).toContainText("Where is my order?");
  await expect(rows).not.toContainText("Wholesale for our club");

  await page.getByLabel("Find a conversation").fill("nobody-by-this-name");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No match")).toBeVisible();
});

test("an email that arrived as HTML is shown as its words, and nothing of it is drawn or run", async ({
  page,
}) => {
  // The demo's email from a phone: markup only, with a tracking picture and
  // a script in it.
  const asked: string[] = [];
  page.on("request", (request) => asked.push(request.url()));
  await open(page, "aroha.ngata", "Change of address");

  const [message] = await messages(page).all();
  if (message === undefined) throw new Error("no message on the page");
  await expect(message).toContainText(
    "Hi team, can I change the address on QP-PACK44? We are staying in town this week.",
  );
  await expect(message).toContainText("Thanks, Aroha");
  await expect(message).toContainText(
    "It arrived as formatted email with no plain text. These are its words. Its own formatting is never shown.",
  );
  // Not one element of the email is on the page: no picture was asked for,
  // no script ran, and its bold is only a word.
  await expect(message.locator("img, script, iframe, b, style")).toHaveCount(0);
  expect(asked.filter((url) => url.includes("pixel.example"))).toEqual([]);
  expect(await page.title()).not.toContain("changed by an email");
  await expect(page.getByText("<b>")).toHaveCount(0);

  // The original is kept, and is only ever a download.
  const original = message.getByRole("link", {
    name: "Download it exactly as it arrived",
  });
  await expect(original).toHaveAttribute("href", /^\/backstage\/files\/fil_/);
  await expect(original).toHaveAttribute("download", "");
  const file = await page.request.get(
    (await original.getAttribute("href")) ?? "",
  );
  expect(file.headers()["content-disposition"]).toContain("attachment");
  expect(file.headers()["content-type"]).toBe("application/octet-stream");

  // It quoted an order, so it is linked to it, and says nothing is sent
  // from a demo before anybody types a word.
  await expect(page.getByTestId("links")).toContainText("QP-PACK44");
  await expect(page.getByTestId("reply-form")).toContainText(
    "This back end is running on invented records, which never sends email. A reply sent from here is written down and marked as not sent.",
  );
});

test("an order's page lists what people have written about it", async ({
  page,
}) => {
  await page.goto("/backstage/orders/QP-SENT66");
  const about = page.getByTestId("order-conversations");
  await expect(about).toContainText("Where is my order?");
  // The order's own emails are listed apart, and are not repeated here.
  await expect(about).not.toContainText("Your Quick Pickle order");
  await about.getByRole("link", { name: /Where is my order\?/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Where is my order?" }),
  ).toBeVisible();
});

test("Today says that email is waiting, and the doors for incoming mail are shut on a server with no secrets", async ({
  page,
}) => {
  await page.goto("/backstage");
  const line = page.getByRole("link", {
    name: /emails? (?:is|are) waiting for a reply/,
  });
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("href", "/backstage/inbox");

  for (const door of ["/api/mail/inbound", "/api/mail/resend"]) {
    const response = await page.request.post(door, {
      headers: { authorization: "Bearer anything-at-all-will-not-do" },
      data: "From: a@example.com\r\n\r\nhello",
    });
    expect(response.status(), door).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: "not_configured",
    });
  }
});

test("the inbox settings name what is connected, and keep saved replies and the do-not-email list", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}-${Date.now().toString(36)}`;
  await page.goto("/backstage/inbox/settings");
  await expect(
    page.getByRole("heading", { level: 1, name: "Inbox settings" }),
  ).toBeVisible();

  // Names, never values.
  const main = page.locator("main");
  await expect(main).toContainText(
    "This is a demo on invented records, so nothing here is connected and nothing is sent.",
  );
  await expect(main).toContainText("RESEND_WEBHOOK_SECRET");
  await expect(main).toContainText("MAIL_TOKEN_SECRET");
  await expect(main).not.toContainText("whsec_");
  await expect(main).not.toContainText(/re_[A-Za-z0-9]{10,}/);

  // A saved reply that could never be sent cannot be kept.
  const name = `Test reply ${tag}`;
  await page.getByText("Add a saved reply").click();
  await page.locator("#tpl-new-name").fill(name);
  await page.locator("#tpl-new-body").fill("It is great for hydration.");
  await page.getByRole("button", { name: "Save the reply" }).click();
  await expect(
    said(
      page,
      "This cannot be kept as written, because it could never be sent.",
    ),
  ).toContainText("hydration");
  await expect(page.getByTestId("saved-replies")).not.toContainText(name);

  await page.getByText("Add a saved reply").click();
  await page.locator("#tpl-new-name").fill(name);
  await page
    .locator("#tpl-new-body")
    .fill("Hi {{first_name}},\n\nThanks for getting in touch.");
  await page.getByRole("button", { name: "Save the reply" }).click();
  await expect(said(page, "Saved.")).toBeVisible();
  const kept = page
    .getByTestId("saved-replies")
    .getByRole("listitem")
    .filter({ hasText: name });
  await expect(kept).toHaveCount(1);
  await kept.locator("summary").click();
  await kept.getByRole("button", { name: `Delete ${name}` }).click();
  await expect(said(page, "Deleted.")).toBeVisible();
  await expect(page.getByTestId("saved-replies")).not.toContainText(name);

  // An address is put on the do-not-email list by hand, and an owner can
  // take it off again.
  const address = `stop-${tag}@example.co.nz`;
  await page.getByLabel("An address to stop emailing").fill(address);
  await page.getByLabel("Why", { exact: true }).fill("Asked us to stop");
  await page.getByRole("button", { name: "Put it on the list" }).click();
  await expect(
    said(
      page,
      "On the do-not-email list. Nothing more will be sent to that address.",
    ),
  ).toBeVisible();
  const row = page
    .getByTestId("do-not-email")
    .getByRole("listitem")
    .filter({ hasText: address });
  await expect(row).toContainText("Put on by hand");
  await expect(row).toContainText("Asked us to stop");
  await row
    .getByRole("button", { name: `Take off the list ${address}` })
    .click();
  await expect(said(page, "Taken off the do-not-email list.")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(address);
});

test.describe("changing a conversation", () => {
  test.skip(
    ({ isMobile }) => !isMobile,
    "One inbox is shared by both sizes of screen: its conversations are changed from one of them.",
  );
  test.describe.configure({ mode: "serial" });

  test("a reply meets the copy rules before it is written down, and a restricted phrase needs a person's tick", async ({
    page,
  }) => {
    await open(page, "kahu.rangi", "Wholesale for our club");
    const reply = page.getByLabel("Your reply");
    const send = page.getByRole("button", { name: "Send", exact: true });

    // A banned phrase never goes, and the words are kept to be put right.
    await reply.fill("It is great for hydration.");
    await send.click();
    const refused = said(page, "This cannot go out as written.");
    await expect(refused).toContainText('"hydration" in the body');
    await expect(refused).toContainText("Your words are saved as a draft.");
    await expect(reply).toHaveValue("It is great for hydration.");
    await expect(page.getByTestId("flags-banned")).toContainText("hydration");
    await expect(messages(page).last()).not.toContainText("hydration");

    // A restricted one is held until a person says they have read it.
    const words = "Hi Kahu, yes we do. Free delivery over $60.";
    await reply.fill(words);
    await send.click();
    await expect(
      said(page, "This needs a person to confirm it is true"),
    ).toContainText('"Free delivery" in the body');
    const flagged = page.getByTestId("flags-restricted");
    await expect(flagged).toContainText("Free delivery");
    await expect(reply).toHaveValue(words);
    await flagged
      .getByRole("checkbox", {
        name: "I have read these, they are true, and they are right to send",
      })
      .check();
    await send.click();

    // On this server nothing is sent, and the screen says so at once.
    await expect(said(page, "Written down, and not sent.")).toContainText(
      "This back end is running on invented records, which never sends email.",
    );
    const ours = messages(page).last();
    await expect(ours).toContainText(words);
    // The signature went under it.
    await expect(ours).toContainText("Quick Pickle");
    await expect(async () => {
      await page.reload();
      await expect(ours).toContainText("Not sent", { timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await expect(ours).toContainText(
      "This back end is running on invented records, which never sends email.",
    );
    await expect(ours).toContainText(
      "A person read what the copy rules flagged before this was queued (FTA-06).",
    );
    // The draft became that message: the box is empty again.
    await expect(page.getByLabel("Your reply")).toHaveValue("");
    await expect(page.getByTestId("flags-restricted")).toHaveCount(0);
  });

  test("a saved reply is put into the draft with what is known about the order filled in", async ({
    page,
  }) => {
    await open(page, "liam.carter", "Where is my order?");
    await page.getByLabel("A saved reply").selectOption({
      label: "Where is my order",
    });
    await page.getByRole("button", { name: "Put it in" }).click();
    await expect(
      said(page, "Put in. Read it through before you send it."),
    ).toBeVisible();
    const reply = page.getByLabel("Your reply");
    await expect(reply).toHaveValue(/Hi Liam,/);
    await expect(reply).toHaveValue(
      /Your order QP-SENT66 left us with NZ Post, and the tracking number is LZ8011558011NZ\./,
    );
    // Nothing has gone anywhere.
    await expect(messages(page)).toHaveCount(1);

    await page.getByRole("button", { name: "Throw the draft away" }).click();
    await expect(said(page, "Draft thrown away.")).toBeVisible();
    await expect(page.getByLabel("Your reply")).toHaveValue("");
  });

  test("a second address quoting somebody else's order is kept apart, tied to its customer by hand, merged, and split off again", async ({
    page,
  }) => {
    await open(page, "moana", "Delivery for the club");
    // Why it is where it is, in a sentence.
    await expect(messages(page).first()).toContainText(
      /which is not this sender's own, so it was linked and kept apart|Split off from/,
    );

    // Say whose address it is. From then on the order is theirs to hear about.
    await page.getByText("Change their details").click();
    await page
      .getByLabel("The customer this address belongs to")
      .fill("liam.carter@example.co.nz");
    await page.getByRole("button", { name: "Save their details" }).click();
    await expect(said(page, /^Saved\./)).toBeVisible();
    await expect(
      page.getByText(
        "This order was not placed by the person you are writing to.",
      ),
    ).toHaveCount(0);

    // It is the same matter as Liam's own email: merge it into that one.
    await page
      .getByLabel("Merge this conversation into")
      .selectOption({ label: "Where is my order?, with Liam Carter" });
    await page.getByRole("button", { name: "Merge them" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Where is my order?" }),
    ).toBeVisible();
    await expect(said(page, "Merged: 1 message came across.")).toBeVisible();
    const moved = messages(page).filter({
      hasText: "following up on Liam's order",
    });
    await expect(moved).toContainText("Placed by hand");
    await expect(moved).toContainText(
      'Merged here from "Delivery for the club" by',
    );
    // A new address in somebody's conversation is pointed out.
    await expect(moved).toContainText(
      "This is the first message here from moana@harbourfc.example.co.nz.",
    );

    // And back out again, which is how a merge is undone.
    await moved.getByText("In the wrong place?").click();
    await moved
      .getByRole("button", { name: "Split the conversation from here" })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Delivery for the club" }),
    ).toBeVisible();
    await expect(
      said(page, "Split off. That message is now a conversation of its own."),
    ).toBeVisible();
    await expect(messages(page)).toHaveCount(1);
    await expect(messages(page).first()).toContainText(
      'Split off from "Where is my order?" by',
    );
  });

  test("a finished conversation is reopened, put away until tomorrow, brought back and finished again", async ({
    page,
  }) => {
    await open(page, "priya.nair", "Has my order left yet?");
    // Her second email joined the first by what it answers.
    await expect(messages(page)).toHaveCount(2);
    await expect(messages(page).nth(1)).toContainText(
      "Joined this conversation because it answers a message in it.",
    );
    await expect(page.getByText("Finished.")).toBeVisible();

    await page.getByRole("button", { name: "Needs a reply" }).click();
    await expect(said(page, "Back in the queue.")).toBeVisible();
    await expect(page.getByText(/^It is our turn/)).toBeVisible();

    await page.getByText("Put it away until later").click();
    await page.getByRole("button", { name: "Tomorrow, 8am" }).click();
    await expect(said(page, /^Put away\./)).toBeVisible();
    // It has left the queue, for a pile that only shows while it is in use.
    await expect(page.getByTestId("conversations")).not.toContainText(
      "Has my order left yet?",
    );
    await page
      .getByRole("navigation", { name: "Piles" })
      .getByRole("link", { name: /^Put away/ })
      .click();
    await page
      .getByTestId("conversations")
      .getByRole("link", { name: "Has my order left yet?" })
      .click();
    await expect(page.getByText(/^Put away until /)).toBeVisible();

    await page.getByText("Put it away until later").click();
    await page.getByRole("button", { name: "Bring it back now" }).click();
    await expect(said(page, "Back in the queue.")).toBeVisible();

    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(said(page, "Done.")).toBeVisible();
    await page
      .getByRole("navigation", { name: "Piles" })
      .getByRole("link", { name: "Done" })
      .click();
    await expect(page.getByTestId("conversations")).toContainText(
      "Has my order left yet?",
    );
  });
});
