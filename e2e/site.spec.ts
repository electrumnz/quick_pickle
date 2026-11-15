import { expect, test } from "@playwright/test";

/**
 * The one page, as a visitor meets it. Runs at a phone's size first.
 */

/**
 * Every element whose own words are cut off, by its own box or by one it
 * sits in. Things cut off on purpose (the ticker, words kept for screen
 * readers) and things not on show are left out. It runs in the page.
 */
function cutOffWords(): string[] {
  const cuts = (value: string) => value === "hidden" || value === "clip";
  const found: string[] = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    // Cut off on purpose, or not on show at all.
    if (
      el.closest(
        '[aria-hidden="true"], [data-marquee], .sr-only, [hidden], dialog:not([open]), details:not([open]) > :not(summary), script, style, noscript',
      ) !== null
    ) {
      continue;
    }
    const words = Array.from(el.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => (node.textContent ?? "").trim())
      .join(" ")
      .trim();
    if (words === "") continue;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (
      rect.width === 0 ||
      rect.height === 0 ||
      style.visibility === "hidden"
    ) {
      continue;
    }
    const name = `${el.tagName.toLowerCase()} "${words.slice(0, 40)}"`;
    // By its own box.
    if (
      (cuts(style.overflowX) && el.scrollWidth > el.clientWidth + 1) ||
      (cuts(style.overflowY) && el.scrollHeight > el.clientHeight + 1)
    ) {
      found.push(`${name} is cut off by its own box`);
      continue;
    }
    // By a box it sits in.
    for (
      let up = el.parentElement;
      up !== null && up !== document.body;
      up = up.parentElement
    ) {
      const outer = getComputedStyle(up);
      if (!cuts(outer.overflowX) && !cuts(outer.overflowY)) continue;
      const box = up.getBoundingClientRect();
      const across =
        cuts(outer.overflowX) &&
        (rect.right > box.right + 1 || rect.left < box.left - 1);
      const down =
        cuts(outer.overflowY) &&
        (rect.bottom > box.bottom + 1 || rect.top < box.top - 1);
      if (across || down) {
        found.push(
          `${name} is cut off by ${up.tagName.toLowerCase()}.${String(up.className).slice(0, 50)}`,
        );
        break;
      }
    }
  }
  return found;
}

test.describe("the page", () => {
  test("says what it is and puts the button on the first screen", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Quick Pickle/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /a little\s+shot\s+of\s+good luck/i,
    );
    await expect(page.getByText("Pickle juice shots").first()).toBeVisible();

    // The call to action is inside the first viewport, no scrolling.
    const cta = page.getByRole("link", {
      name: /pre-order a pack|grab a pack/i,
    });
    await expect(cta.first()).toBeInViewport();
  });

  test("has every section the page promises, in order", async ({ page }) => {
    await page.goto("/");
    const headings = await page
      .getByRole("heading", { level: 2 })
      .allInnerTexts();
    const flat = headings.map((text) =>
      text.replace(/\s+/g, " ").toLowerCase(),
    );
    const expected = [
      "pick your pack.",
      "clear as a whistle.",
      "move over, oranges.",
      "meet lucky.",
      "join the pickle crew.",
      "fair questions.",
      "lucky you've got us.",
    ];
    let cursor = 0;
    for (const want of expected) {
      const at = flat.findIndex(
        (text, index) => index >= cursor && text === want,
      );
      expect(at, `"${want}" in ${JSON.stringify(flat)}`).toBeGreaterThanOrEqual(
        cursor,
      );
      cursor = at + 1;
    }
  });

  test("never scrolls sideways, down to the narrowest phone", async ({
    page,
  }) => {
    // 320 is an iPhone SE in zoomed display mode: the tightest real screen.
    const widths = [320, 360, page.viewportSize()?.width ?? 412];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 720 });
      for (const path of ["/", "/checkout", "/delivery", "/backstage/brand"]) {
        await page.goto(path);
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow, `${path} at ${String(width)}px`).toBeLessThanOrEqual(
          0,
        );
      }
    }
  });

  test("cuts nothing off when a reader spaces the text out", async ({
    page,
  }) => {
    // WCAG 1.4.12, and the brand pack's own rule: with line height 1.5,
    // paragraphs 2em apart, letters 0.12em apart and words 0.16em apart,
    // every word must still be there to read.
    const SPACED = `
      * {
        line-height: 1.5 !important;
        letter-spacing: 0.12em !important;
        word-spacing: 0.16em !important;
      }
      p { margin-bottom: 2em !important; }
    `;
    // First, proof that the check can see a cut-off line at all.
    await page.goto("/delivery");
    await page.evaluate(() => {
      const probe = document.createElement("p");
      probe.textContent = "A line that is far too long for the box it is in";
      probe.style.cssText =
        "inline-size:40px;overflow:hidden;white-space:nowrap";
      document.querySelector("main")?.append(probe);
    });
    expect(await page.evaluate(cutOffWords)).toEqual([
      'p "A line that is far too long for the box " is cut off by its own box',
    ]);

    for (const path of [
      "/",
      "/checkout",
      "/delivery",
      "/privacy",
      "/for/clubs",
    ]) {
      await page.goto(path);
      await page.addStyleTag({ content: SPACED });
      await page.waitForTimeout(400);
      const sideways = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(sideways, `${path} scrolls sideways`).toBeLessThanOrEqual(0);

      const cutOff = await page.evaluate(cutOffWords);
      expect(cutOff, path).toEqual([]);
    }
  });

  test("answers its questions without leaving the page", async ({ page }) => {
    await page.goto("/");
    const question = page.getByText("Are there pickles in it?");
    await question.scrollIntoViewIfNeeded();
    await question.click();
    await expect(page.getByText("Nope. No pickles, no bits")).toBeVisible();
  });

  test("hands back what was typed when the Pickle Crew form says no", async ({
    page,
  }) => {
    await page.goto("/");
    const crew = page.getByRole("textbox", { name: "Email address" });
    await crew.scrollIntoViewIfNeeded();
    await crew.fill("not-an-email");
    await page.getByRole("button", { name: "I'm in" }).click();
    await expect(page.locator("#crew-error")).toContainText(
      "That email doesn't look right.",
    );
    // React empties a form when its action answers. The typo is still
    // there to fix, not gone.
    await expect(crew).toHaveValue("not-an-email");
  });

  test("reads whole with JavaScript switched off", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Reveal-on-scroll must never hide content when there is no script.
    const hidden = await page
      .locator("[data-reveal]")
      .evaluateAll(
        (blocks) =>
          blocks.filter((block) => getComputedStyle(block).opacity !== "1")
            .length,
      );
    expect(hidden).toBe(0);
    await context.close();
  });

  test("stays out of search while the offer is a stand-in", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    const robots = await page.request.get("/robots.txt");
    expect(await robots.text()).toMatch(/Disallow: \//);
  });

  test("serves the fine print and a real 404", async ({ page }) => {
    for (const path of ["/delivery", "/returns", "/terms", "/privacy"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    const missing = await page.goto("/not-a-page");
    expect(missing?.status()).toBe(404);
    await expect(page.getByText(/napping cat/i)).toBeVisible();
  });

  // The unsubscribe link in an email. Its address holds a token that stands
  // for one person, so the page is never indexed and never counted as a
  // visit. (What the button does with a real token is in the unit tests: a
  // browser test has no way to know one, and nothing should give it one.)
  test("says so for a link to leave the list that is not ours, and counts nobody", async ({
    page,
  }) => {
    const link = "/unsubscribe/not-one-of-ours-at-all-0123";
    const counted: string[] = [];
    page.on("request", (each) => {
      if (each.url().includes("/api/seen")) counted.push(each.url());
    });
    // The same watch sees an ordinary page being counted.
    const seen = page.waitForRequest((each) =>
      each.url().includes("/api/seen"),
    );
    await page.goto("/delivery");
    await seen;
    counted.length = 0;

    const response = await page.goto(link);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"] ?? "").toMatch(/no-store/);
    const panel = page.getByTestId("unsubscribe");
    await expect(panel.getByRole("heading", { level: 1 })).toBeVisible();
    // Nobody is named, and there is nothing to press but the way back.
    await expect(panel).not.toContainText("@");
    await expect(panel.getByRole("button")).toHaveCount(0);
    await expect(panel.getByRole("link")).toHaveAttribute("href", "/");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
      "content",
      "no-referrer",
    );
    await page.waitForTimeout(1200);
    expect(counted).toEqual([]);

    // The address a mail program posts to for its own unsubscribe button.
    const pressed = await page.request.post(`${link}/one-click`, {
      form: { "List-Unsubscribe": "One-Click" },
    });
    expect(pressed.status()).toBe(404);
    // Followed as a link, it leads to the page and changes nothing.
    const followed = await page.request.get(`${link}/one-click`, {
      maxRedirects: 0,
    });
    expect(followed.status()).toBe(303);
    expect(followed.headers().location).toMatch(new RegExp(`${link}$`));
  });

  // The shop's stylesheet only scans the folders it names (app/globals.css).
  // A file left off that list loses its utility classes without any error:
  // the first time, it was the class that stretches the page to the bottom of
  // the screen, and a short page ended in a band of bare navy.
  test("fills the screen on pages shorter than it", async ({ page }) => {
    for (const path of [
      "/checkout",
      "/not-a-page",
      "/order/thanks",
      "/unsubscribe/not-one-of-ours-at-all-0123",
    ]) {
      await page.goto(path);
      const gap = await page.evaluate(() => {
        const body = document.body.getBoundingClientRect();
        return Math.round(window.innerHeight - body.bottom);
      });
      expect(gap, `${path} leaves a gap under the page`).toBeLessThanOrEqual(0);
    }
  });
});
