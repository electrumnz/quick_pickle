import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Driving the site with a keyboard, and checking what a keyboard user can see.
 *
 * Nothing in here clicks. Every move is Tab, Shift+Tab, Enter, Space or an
 * arrow key, which is the only way to find out whether the shop can actually be
 * used without a pointer — a `page.click()` succeeds on a control no keyboard
 * can reach.
 */

export type FocusStop = {
  readonly tag: string;
  readonly name: string;
  readonly href: string | null;
  /** Where the browser draws the ring, if it draws one. */
  readonly ring: readonly string[];
  readonly focusVisible: boolean;
  readonly rendered: boolean;
  readonly inViewport: boolean;
  /**
   * "open" / "closed" when the stop is inside a `<details>` PANEL, else null.
   *
   * The `<summary>` is excluded: it is the control that opens the disclosure
   * and is meant to be focusable whether or not the panel is showing. What
   * must never be reachable is a link in a panel that is shut.
   */
  readonly inDisclosure: string | null;
};

/**
 * Read the focused element.
 *
 * The ring is looked for on the element, on its `::before` and `::after`, and
 * on three levels of ancestor with their pseudo-elements too — because this
 * build draws it in three different legitimate places. `app/globals.css` puts
 * one outline on `:focus-visible` for everything; the product card draws it on
 * a `::after` overlay that covers the whole card, since the anchor itself is
 * only as big as its text; and the size pills draw it on the `<label>` around
 * a visually-hidden radio. Looking only at the element would call two of those
 * three a missing focus ring, which is how a check like this stops being read.
 */
export async function focusStop(page: Page): Promise<FocusStop | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return null;

    const ringOf = (node: Element, pseudo: string | null): string | null => {
      const style = getComputedStyle(node, pseudo ?? undefined);
      const width = Number.parseFloat(style.outlineWidth || "0");
      if (style.outlineStyle !== "none" && width > 0) {
        return `${node.tagName}${pseudo ?? ""} outline ${style.outlineWidth}`;
      }
      if (style.boxShadow !== "" && style.boxShadow !== "none") {
        return `${node.tagName}${pseudo ?? ""} box-shadow`;
      }
      return null;
    };

    const ring: string[] = [];
    let node: Element | null = el;
    let depth = 0;
    while (node !== null && depth <= 3) {
      for (const pseudo of [null, "::before", "::after"]) {
        const hit = ringOf(node, pseudo);
        if (hit !== null) ring.push(hit);
      }
      node = node.parentElement;
      depth += 1;
    }

    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const summary = el.closest("summary");
    const details = summary === null ? el.closest("details") : null;

    return {
      tag: el.tagName,
      name: (el.getAttribute("aria-label") ?? el.textContent ?? "")
        .trim()
        .slice(0, 60),
      href: el.getAttribute("href"),
      ring,
      focusVisible: el.matches(":focus-visible"),
      rendered:
        box.width > 0 &&
        box.height > 0 &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0.01,
      inViewport:
        box.bottom > 0 &&
        box.top < window.innerHeight &&
        box.right > 0 &&
        box.left < window.innerWidth,
      inDisclosure: details === null ? null : details.open ? "open" : "closed",
    };
  });
}

/**
 * Press Tab and report where focus landed, once the page has stopped moving.
 *
 * The wait is not padding. The storefront runs Lenis, which replaces the
 * browser's instant scroll with an animated one, so the element the browser
 * has just focused is genuinely 2,700px below the fold for a few frames. A
 * check that read the position immediately would fail on a page that is
 * behaving correctly.
 */
export async function pressTab(
  page: Page,
  key: "Tab" | "Shift+Tab" = "Tab",
): Promise<FocusStop | null> {
  await page.keyboard.press(key);
  let stop = await focusStop(page);
  for (
    let attempt = 0;
    attempt < 20 && stop !== null && !stop.inViewport;
    attempt += 1
  ) {
    await page.waitForTimeout(100);
    stop = await focusStop(page);
  }
  return stop;
}

/** Every rule a focus stop has to satisfy, in one place. */
export function expectUsableStop(stop: FocusStop | null): void {
  expect(stop, "focus left the document").not.toBeNull();
  if (stop === null) return;

  expect(
    stop.rendered,
    `focus landed on something that is not rendered: <${stop.tag.toLowerCase()}> ${stop.name}`,
  ).toBe(true);
  expect(
    stop.inViewport,
    `focus landed off screen and the page did not scroll to it: <${stop.tag.toLowerCase()}> ${stop.name}`,
  ).toBe(true);
  expect(
    stop.focusVisible,
    `the browser does not consider this keyboard focus: <${stop.tag.toLowerCase()}> ${stop.name}`,
  ).toBe(true);
  expect(
    stop.ring,
    `no focus ring anywhere on or around <${stop.tag.toLowerCase()}> ${stop.name}`,
  ).not.toEqual([]);
  expect(
    stop.inDisclosure,
    `focus reached inside a CLOSED disclosure panel: <${stop.tag.toLowerCase()}> ${stop.name}`,
  ).not.toBe("closed");
}

/**
 * Tab forward until `target` has focus, checking every stop on the way.
 *
 * Returns the stops it passed through, so a test can say what the route to a
 * control actually was.
 */
export async function tabTo(
  page: Page,
  target: Locator,
  maxTabs = 60,
): Promise<readonly FocusStop[]> {
  const stops: FocusStop[] = [];
  for (let pressed = 0; pressed < maxTabs; pressed += 1) {
    const stop = await pressTab(page);
    expectUsableStop(stop);
    if (stop !== null) stops.push(stop);
    if (await target.evaluate((el) => el === document.activeElement)) {
      return stops;
    }
  }
  const trail = stops
    .map((stop) => `<${stop.tag.toLowerCase()}> ${stop.name}`)
    .join(" → ");
  throw new Error(
    `Tabbed ${String(maxTabs)} times and never reached the target. Focus went: ${trail}`,
  );
}
