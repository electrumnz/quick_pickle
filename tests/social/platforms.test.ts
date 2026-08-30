/**
 * The preview's facts, checked against the two things that can make them wrong.
 *
 * A platform table rots in two ways. The first is drifting away from the
 * schema: `social_posts.platform` is an enum and a preview that covers seven of
 * its eight values leaves one post type with nothing to look at. That is caught
 * here by reading the migration.
 *
 * The second is somebody tightening a number without a source, or loosening one
 * to make a caption fit. Every entry therefore has to carry at least one source
 * and to be internally consistent — a fold cannot be past the ceiling, a
 * measured fold cannot claim to be published — and the numbers this unit was
 * built around are pinned by name so that changing one is a deliberate edit to
 * a test rather than a quiet edit to a table.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEVICES,
  PREVIEW_SURFACES,
  SOCIAL_PLATFORMS,
  SURFACES,
  surfacesForPost,
} from "@/lib/social";

const ROOT = path.resolve(__dirname, "..", "..");

/** `create type public.social_platform as enum (...)`, read from the migration. */
function platformsInSchema(): readonly string[] {
  const sql = readFileSync(
    path.join(ROOT, "supabase", "migrations", "20260101000700_marketing.sql"),
    "utf8",
  );
  const match =
    /create type public\.social_platform as enum \(([\s\S]*?)\);/.exec(sql);
  if (match?.[1] === undefined) {
    throw new Error(
      "social_platform enum not found in the marketing migration",
    );
  }
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1] ?? "");
}

describe("the platform list mirrors the schema", () => {
  it("covers every value of public.social_platform, and invents none", () => {
    expect([...SOCIAL_PLATFORMS].sort()).toEqual(
      [...platformsInSchema()].sort(),
    );
  });

  it("gives every platform at least one surface to be previewed on", () => {
    for (const platform of SOCIAL_PLATFORMS) {
      const surfaces = PREVIEW_SURFACES.map((id) => SURFACES[id]).filter(
        (surface) => surface.platform === platform,
      );
      expect(
        surfaces.length,
        `${platform} has no preview surface`,
      ).toBeGreaterThan(0);
    }
  });

  it("puts the post's own platform first and still offers the rest", () => {
    const forX = surfacesForPost("x");
    expect(forX[0]?.id).toBe("x");
    expect(forX).toHaveLength(PREVIEW_SURFACES.length);

    const forInstagram = surfacesForPost("instagram");
    expect(forInstagram.slice(0, 2).map((surface) => surface.id)).toEqual([
      "instagram_feed",
      "instagram_story",
    ]);
  });

  it("falls back to the whole list for a platform it does not know", () => {
    expect(surfacesForPost("myspace")).toHaveLength(PREVIEW_SURFACES.length);
  });
});

describe("every surface is internally consistent", () => {
  for (const id of PREVIEW_SURFACES) {
    const surface = SURFACES[id];

    it(`${id} carries a source for its numbers`, () => {
      expect(surface.sources.length).toBeGreaterThan(0);
      for (const source of surface.sources) {
        expect(source.url).toMatch(/^https:\/\//);
        expect(source.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(source.what.length).toBeGreaterThan(0);
      }
    });

    it(`${id} never folds past its own ceiling`, () => {
      for (const device of DEVICES) {
        const at = surface.caption.collapsesAt[device];
        if (at === null) continue;
        expect(at).toBeGreaterThan(0);
        expect(at).toBeLessThanOrEqual(surface.caption.max);
      }
    });

    it(`${id} does not claim a fold it has no figure for`, () => {
      const anyFold = DEVICES.some(
        (device) => surface.caption.collapsesAt[device] !== null,
      );
      // `unknown` and "we drew a line" are the pair that must never co-occur:
      // that combination is exactly the confident wrong line this unit exists
      // to avoid.
      expect(anyFold).toBe(surface.caption.collapseKind !== "unknown");
    });

    it(`${id} has a frame to crop into and a column to render in`, () => {
      expect(surface.frames.length).toBeGreaterThan(0);
      for (const frame of surface.frames) {
        expect(frame.ratio).toBeGreaterThan(0);
        expect(Number.isFinite(frame.ratio)).toBe(true);
      }
      for (const device of DEVICES) {
        expect(surface.column[device]).toBeGreaterThan(100);
        expect(surface.column[device]).toBeLessThan(1200);
      }
    });

    it(`${id} says what it cannot know`, () => {
      expect(surface.caveat.length).toBeGreaterThan(20);
    });
  }
});

/**
 * The numbers themselves, pinned.
 *
 * Each of these was read from the source quoted beside it in
 * `lib/social/platforms.ts` on 2026-08-30. They will move — that is the nature
 * of them — and when one does, this test is the place the change is argued
 * rather than slipped in.
 */
describe("the limits this unit was built around", () => {
  it("Instagram: 2,200 characters, 30 hashtags, 20 @ tags, folds at 125", () => {
    const feed = SURFACES.instagram_feed;
    expect(feed.caption.max).toBe(2200);
    expect(feed.hashtagMax).toBe(30);
    expect(feed.mentionMax).toBe(20);
    expect(feed.caption.collapsesAt.phone).toBe(125);
    expect(feed.caption.collapseKind).toBe("measured");
  });

  it("Instagram story: 9:16, and no caption at all", () => {
    const story = SURFACES.instagram_story;
    expect(story.showsCaption).toBe(false);
    expect(story.frames[0]?.ratio).toBeCloseTo(9 / 16, 4);
  });

  it("X: 280, counted X's way, with the text above the picture", () => {
    expect(SURFACES.x.caption.max).toBe(280);
    expect(SURFACES.x.caption.counts).toBe("weighted");
    expect(SURFACES.x.caption.urlWeight).toBe(23);
    expect(SURFACES.x.captionFirst).toBe(true);
  });

  it("Facebook: 63,206, folding at 477 on a desktop and 250 on a phone", () => {
    expect(SURFACES.facebook.caption.max).toBe(63206);
    expect(SURFACES.facebook.caption.collapsesAt.desktop).toBe(477);
    expect(SURFACES.facebook.caption.collapsesAt.phone).toBe(250);
  });

  it("LinkedIn: 3,000, folding at 210 on a desktop and 140 on a phone", () => {
    expect(SURFACES.linkedin.caption.max).toBe(3000);
    expect(SURFACES.linkedin.caption.collapsesAt.desktop).toBe(210);
    expect(SURFACES.linkedin.caption.collapsesAt.phone).toBe(140);
  });

  it("TikTok: 2,200 UTF-16 runes, about 100 of them visible", () => {
    expect(SURFACES.tiktok.caption.max).toBe(2200);
    expect(SURFACES.tiktok.caption.collapsesAt.phone).toBe(100);
  });

  it("Threads: 500, published, with no fold drawn", () => {
    expect(SURFACES.threads.caption.max).toBe(500);
    expect(SURFACES.threads.caption.collapseKind).toBe("unknown");
  });

  it("YouTube's ceiling is bytes, which nothing else here is", () => {
    expect(SURFACES.youtube.caption.max).toBe(5000);
    expect(SURFACES.youtube.caption.counts).toBe("utf8");
  });

  it("Pinterest: 800, from Pinterest's own OpenAPI description", () => {
    expect(SURFACES.pinterest.caption.max).toBe(800);
  });

  it("only Instagram's feed writes the handle in front of the caption", () => {
    const prefixing = PREVIEW_SURFACES.filter(
      (id) => SURFACES[id].handlePrefix,
    );
    expect(prefixing).toEqual(["instagram_feed"]);
  });

  it("counts the link against the limit only where the link is in the text", () => {
    const carries = PREVIEW_SURFACES.filter((id) => SURFACES[id].linkInCaption);
    expect([...carries].sort()).toEqual([
      "facebook",
      "linkedin",
      "threads",
      "x",
    ]);
    // The ones left out are the ones where a caption cannot hold a working
    // link at all. Counting a URL against Instagram's 2,200 would overstate the
    // length and hide the actual problem, which is that the link does nothing.
    expect(SURFACES.instagram_feed.linkInCaption).toBe(false);
    expect(SURFACES.tiktok.linkInCaption).toBe(false);
  });

  it("spells the expander with its own ellipsis and no second one", () => {
    for (const id of PREVIEW_SURFACES) {
      const word = SURFACES[id].caption.moreWord;
      expect(word.startsWith("…"), `${id}: ${word}`).toBe(true);
      expect(word.slice(1)).not.toContain("…");
    }
  });

  it("the four frames the brief names are all reachable", () => {
    const ratios = PREVIEW_SURFACES.flatMap((id) =>
      SURFACES[id].frames.map((frame) => frame.ratio),
    );
    const has = (target: number): boolean =>
      ratios.some((ratio) => Math.abs(ratio - target) < 0.01);
    expect(has(1), "1:1 feed").toBe(true);
    expect(has(0.8), "4:5 feed").toBe(true);
    expect(has(9 / 16), "9:16 story").toBe(true);
    expect(has(1.91), "1.91:1 link card").toBe(true);
  });
});
