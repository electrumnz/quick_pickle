import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sniff } from "@/lib/assets/formats";
import { scrub } from "@/lib/assets/scrub";

const FILES = [
  "public/media/bottles/no-01-house.jpg",
  "public/media/film/no-01-house-poster.jpg",
  "public/3d/fallback/bottle-hero.png",
  "public/3d/labels/label-01-house-wrap.png",
  "public/media/film/no-01-house.mp4",
  "public/media/film/range.mp4",
];

describe("scratch", () => {
  it("reads the repo's own media", () => {
    for (const file of FILES) {
      const bytes = new Uint8Array(readFileSync(file));
      const { format, detail } = sniff(bytes);
      const result = scrub(bytes, format);
      console.log(
        JSON.stringify({
          file,
          mime: format.mime,
          detail,
          before: bytes.length,
          after: result.bytes.length,
          removed: result.removed,
          hadLocation: result.hadLocation,
          width: result.width,
          height: result.height,
          durationMs: result.durationMs,
          capturedAt: result.capturedAt,
        }),
      );
      expect(result.bytes.length).toBeGreaterThan(0);
    }
  });
});
