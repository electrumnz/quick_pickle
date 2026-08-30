import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The hero band never touches the hero's copy.
 *
 * This is the founder's third reported defect written as a measurement. The
 * scrub scales `[data-hero-art]` to 1.16, and a transform does not affect
 * layout, so the scaled picture used to grow straight over the positioning
 * line. `.heroStage` has `overflow: hidden`, but that clips at the STAGE edge —
 * there was nothing between the art and the band. Measured on the build before
 * the fix, at the end of the scrub, the art's painted box crossed the line's
 * own text box by 11.6px at 375, 10.2px at 768, 7.4px at 1280 and 3.6px at
 * 1920.
 *
 * `.heroFrame` — the art's parent — now clips, so the zoom is kept and grows
 * inside its own bounds. The thing that has to be true is therefore about
 * PAINTED pixels, not about boxes: `getBoundingClientRect()` on a transformed
 * element reports the untransformed geometry scaled, with no regard for any
 * ancestor that clips it, so the rect alone would still overlap and prove
 * nothing. The rect is intersected with every clipping ancestor and with the
 * viewport first, which is what actually reaches the screen.
 *
 * The scroll is driven with real wheel events rather than `window.scrollTo`:
 * Lenis owns the scroll position and reverts a programmatic one inside a frame,
 * so every sample would come back at progress 0.
 */

const STOPS = [0, 0.25, 0.5, 0.75, 1] as const;

/** Wheel to an absolute scroll offset and let Lenis stop easing. */
async function scrollTo(page: Page, target: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const y = await page.evaluate(() => window.scrollY);
    const delta = target - y;
    if (Math.abs(delta) < 8) break;
    await page.mouse.wheel(0, Math.max(-900, Math.min(900, delta)));
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(700);
}

interface Sample {
  readonly scrollY: number;
  readonly transform: string;
  readonly artPainted: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  } | null;
  readonly lineBox: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  } | null;
  readonly overlapHeight: number;
  readonly gap: number;
}

async function sample(page: Page): Promise<Sample> {
  return page.evaluate(() => {
    type Box = { top: number; bottom: number; left: number; right: number };
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };

    /* The rect that survives every ancestor that clips, and the viewport. */
    const painted = (el: Element): Box => {
      let out = box(el);
      for (
        let parent = el.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (style.overflowX === "visible" && style.overflowY === "visible")
          continue;
        const clip = box(parent);
        out = {
          top: Math.max(out.top, clip.top),
          bottom: Math.min(out.bottom, clip.bottom),
          left: Math.max(out.left, clip.left),
          right: Math.min(out.right, clip.right),
        };
      }
      return {
        top: Math.max(out.top, 0),
        bottom: Math.min(out.bottom, window.innerHeight),
        left: Math.max(out.left, 0),
        right: Math.min(out.right, window.innerWidth),
      };
    };

    const art = document.querySelector("[data-hero-art]");
    const line = document.querySelector("[data-hero-line]");
    const artPainted = art ? painted(art) : null;
    const lineBox = line ? box(line) : null;

    let overlapHeight = 0;
    let gap = Number.POSITIVE_INFINITY;
    if (artPainted && lineBox) {
      const h =
        Math.min(artPainted.bottom, lineBox.bottom) -
        Math.max(artPainted.top, lineBox.top);
      const w =
        Math.min(artPainted.right, lineBox.right) -
        Math.max(artPainted.left, lineBox.left);
      overlapHeight = h > 0 && w > 0 ? h : 0;
      gap = lineBox.top - artPainted.bottom;
    }

    return {
      scrollY: Math.round(window.scrollY),
      transform: art ? getComputedStyle(art).transform : "none",
      artPainted,
      lineBox,
      overlapHeight: Math.round(overlapHeight * 10) / 10,
      gap: Math.round(gap * 10) / 10,
    };
  });
}

for (const width of [375, 768, 1280, 1920]) {
  test(`the hero art never paints over the positioning line at ${String(width)}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator("[data-hero-art]")).toBeVisible();
    // The scrub only exists once HeroScrub has attached and opted the track in.
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-hero-track]")
          ?.getAttribute("data-scrub") === "on",
      undefined,
      { timeout: 15_000 },
    );

    const height = 900;
    const span = await page.evaluate(
      (viewportHeight) =>
        Math.max(
          0,
          (document.querySelector("[data-hero-track]")?.getBoundingClientRect()
            .height ?? 0) - viewportHeight,
        ),
      height,
    );
    expect(span).toBeGreaterThan(0);

    const seen: string[] = [];
    for (const stop of STOPS) {
      await scrollTo(page, span * stop);
      const measured = await sample(page);
      seen.push(
        `${String(Math.round(stop * 100)).padStart(3)}%  y=${String(measured.scrollY).padStart(5)}  ` +
          `transform ${measured.transform}  gap ${measured.gap}px  overlap ${measured.overlapHeight}px`,
      );
      expect(
        measured.artPainted,
        `[data-hero-art] is missing at ${String(width)}`,
      ).not.toBeNull();
      expect(
        measured.lineBox,
        `[data-hero-line] is missing at ${String(width)}`,
      ).not.toBeNull();
      expect(
        measured.overlapHeight,
        `the art painted over the positioning line at ${String(width)}, scrub ${String(Math.round(stop * 100))}%\n${seen.join("\n")}`,
      ).toBe(0);
    }

    // The scrub really did run: a still hero would pass the test above for the
    // wrong reason.
    const transforms = new Set(
      seen.map((row) => row.slice(row.indexOf("transform"))),
    );
    expect(transforms.size).toBeGreaterThan(1);
  });
}

test("the hero mounts no film", async ({ page }) => {
  // `range.webm` is a lateral truck, not the push-in it was documented as —
  // measured in components/product/media.ts. It is the drift the founder
  // reported, it is inherent to the file, and the hero runs the still alone.
  // FilmMount arms on requestIdleCallback with a 4s timeout.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.locator("[data-hero-art] img")).toBeVisible();
  await page.waitForTimeout(6000);
  await expect(page.locator("[data-hero-track] video")).toHaveCount(0);
});
