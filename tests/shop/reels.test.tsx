import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReelsSection } from "@/components/site/Sections";
import { MEDIA } from "@/content/media";
import { REELS } from "@/content/site";
import { checkOutgoing } from "@/lib/backstage/core/copy";

/**
 * The strip of films on the shop's page: what it plays, that it plays it
 * quietly, that it says how the film was made, and that the files are there
 * and small enough for a phone.
 */

describe("the strip of films", () => {
  const html = renderToStaticMarkup(<ReelsSection />);

  it("plays each film silent, on a loop, with its caption and its poster", () => {
    expect(MEDIA.reels.length).toBeGreaterThan(0);
    expect(html).toContain(REELS.title);
    expect(html.match(/<video\b/g)).toHaveLength(MEDIA.reels.length);
    for (const reel of MEDIA.reels) {
      expect(html).toContain(`poster="${reel.src}-poster.webp"`);
      // One film is a feature, with its caption among the words beside it.
      expect(html).toContain(`>${reel.caption}</p>`);
    }
    // Muted, looping and inline: nothing plays a sound at anybody.
    expect(html).not.toMatch(/<video(?![^>]*\bmuted\b)/);
    expect(html).not.toMatch(/<video(?![^>]*\bloop\b)/);
  });

  it("says the film was made with AI, and that the people are not real", () => {
    expect(MEDIA.reels.every((reel) => reel.madeWithAi === true)).toBe(true);
    const people = MEDIA.reels.some((reel) => reel.people === true);
    expect(html).toContain(
      `>${people ? REELS.notRealPeople : REELS.madeWithAi}</p>`,
    );
  });

  it("is there to play, and small enough for a phone", () => {
    for (const reel of MEDIA.reels) {
      const poster = join("public", `${reel.src}-poster.webp`);
      expect(existsSync(poster), poster).toBe(true);
      // The poster is fetched with the page, so it is kept small.
      expect(statSync(poster).size, poster).toBeLessThan(100 * 1024);
      for (const format of reel.formats) {
        const file = join("public", `${reel.src}.${format}`);
        expect(existsSync(file), file).toBe(true);
        // The film itself only loads as it comes on screen.
        expect(statSync(file).size, file).toBeLessThan(2 * 1024 * 1024);
      }
      // Upright, like a reel, so it fills its card without bars.
      expect(reel.height / reel.width).toBeCloseTo(16 / 9, 2);
    }
  });

  it("goes out with words that pass the copy rules", () => {
    for (const reel of MEDIA.reels) {
      expect(checkOutgoing({ caption: reel.caption, alt: reel.alt })).toEqual(
        [],
      );
    }
    expect(
      checkOutgoing({ a: REELS.madeWithAi, b: REELS.notRealPeople }),
    ).toEqual([]);
  });
});
