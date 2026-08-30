/**
 * Proof that the metadata is gone.
 *
 * The headline case is the first one: a real photograph out of this repository,
 * with a real EXIF block carrying real GPS coordinates put into it exactly the
 * way a phone writes one. The test reads the coordinates back out of the file
 * that arrives, then asserts that the file the library would store contains
 * neither the coordinates, nor the EXIF block that held them, nor any trace of
 * the TIFF structure — while still being a JPEG with the same pixels.
 */

import { describe, expect, it } from "vitest";

import { sniff } from "@/lib/assets/formats";
import { readExif, scrub } from "@/lib/assets/scrub";
import {
  FIXTURE_TAKEN,
  exifWithGps,
  heicWithGps,
  jpegWithGps,
  pngWithExif,
  quicktimeWithLocation,
  repoFile,
  webpWithExif,
} from "./support/fixtures";

/** Does `haystack` contain `needle`, byte for byte? */
function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (
    let start = 0;
    start <= haystack.length - needle.length;
    start += 1
  ) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

function ascii(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
}

describe("a phone photo carrying GPS", () => {
  const original = jpegWithGps();
  const { format } = sniff(original);
  const result = scrub(original, format);

  it("really does carry coordinates before the scrub", () => {
    // The block is there, and it is readable: this is the file she chose.
    expect(contains(original, exifWithGps())).toBe(true);
    const app1 = original.subarray(2 + 4 + 6, 2 + 4 + 6 + 160);
    const facts = readExif(app1);
    expect(facts.hasGps).toBe(true);
    expect(facts.capturedAt).toBe("2026-09-14T10:31:08.000Z");
    expect(ascii(original).includes("Exif\u0000\u0000")).toBe(true);
  });

  it("stores a file with no EXIF block in it at all", () => {
    expect(result.hadLocation).toBe(true);
    expect(contains(result.bytes, exifWithGps())).toBe(false);
    expect(ascii(result.bytes.subarray(0, 4096)).includes("Exif")).toBe(false);
    // No APP1 segment survives anywhere in the header.
    for (let index = 0; index + 1 < 4096; index += 1) {
      const isApp1 =
        result.bytes[index] === 0xff && result.bytes[index + 1] === 0xe1;
      expect(isApp1).toBe(false);
    }
    expect(result.removed.join(" ")).toContain("GPS");
  });

  it("keeps the date it was taken as data, and the coordinates as a boolean", () => {
    expect(result.capturedAt).toBe("2026-09-14T10:31:08.000Z");
    expect(FIXTURE_TAKEN.startsWith("2026:09:14")).toBe(true);
    // Nothing in the result names a place or a number from the GPS block.
    expect(JSON.stringify({ ...result, bytes: undefined })).not.toContain(
      "174",
    );
  });

  it("is still the same JPEG, pixel for pixel", () => {
    expect(sniff(result.bytes).format.mime).toBe("image/jpeg");
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1280);

    const source = repoFile("public/media/bottles/no-01-house.jpg");
    const scanOf = (bytes: Uint8Array): Uint8Array => {
      for (let index = 2; index + 1 < bytes.length; index += 1) {
        if (bytes[index] === 0xff && bytes[index + 1] === 0xda) {
          return bytes.subarray(index);
        }
      }
      return new Uint8Array(0);
    };
    expect(scanOf(result.bytes)).toEqual(scanOf(source));
  });

  it("is idempotent — scrubbing the stored file changes nothing", () => {
    const again = scrub(result.bytes, format);
    expect(again.bytes).toEqual(result.bytes);
    expect(again.hadLocation).toBe(false);
  });

  it("refuses a truncated file rather than storing half of one", () => {
    expect(() => scrub(original.subarray(0, 40), format)).toThrowError(
      /did not read as a complete/i,
    );
  });
});

describe("PNG", () => {
  const original = pngWithExif();
  const result = scrub(original, sniff(original).format);

  it("drops the eXIf and the text chunks and keeps the pixels", () => {
    expect(result.hadLocation).toBe(true);
    expect(contains(original, exifWithGps())).toBe(true);
    expect(contains(result.bytes, exifWithGps())).toBe(false);
    expect(ascii(result.bytes).includes("GPSLatitude")).toBe(false);
    expect(result.width).toBe(720);
    expect(result.height).toBe(960);
    expect(sniff(result.bytes).format.mime).toBe("image/png");
    expect(result.bytes.length).toBeLessThan(original.length);
    // The image data itself is untouched: same length as the file we started
    // from before the fixture added its chunks.
    expect(result.bytes.length).toBe(
      repoFile("public/3d/fallback/bottle-hero.png").length,
    );
  });
});

describe("WebP", () => {
  const original = webpWithExif();
  const result = scrub(original, sniff(original).format);

  it("drops EXIF and XMP and clears the flags that claimed them", () => {
    expect(result.hadLocation).toBe(true);
    expect(ascii(result.bytes).includes("EXIF")).toBe(false);
    expect(ascii(result.bytes).includes("XMP")).toBe(false);
    expect(result.width).toBe(100);
    expect(result.height).toBe(200);
    // The VP8X feature byte no longer advertises EXIF (0x08) or XMP (0x04).
    const vp8xFlagByte = result.bytes[20] ?? 0xff;
    expect(vp8xFlagByte & 0x0c).toBe(0);
    expect(sniff(result.bytes).format.mime).toBe("image/webp");
  });
});

describe("HEIC", () => {
  const fixture = heicWithGps();
  const result = scrub(fixture.bytes, sniff(fixture.bytes).format);

  it("zeroes the EXIF item in place, so every other offset still holds", () => {
    expect(result.hadLocation).toBe(true);
    expect(result.bytes.length).toBe(fixture.bytes.length);
    const item = result.bytes.subarray(
      fixture.exifStart,
      fixture.exifStart + fixture.exifLength,
    );
    expect(item.every((byte) => byte === 0)).toBe(true);
    expect(contains(result.bytes, exifWithGps())).toBe(false);
    // The picture item, immediately before it, is untouched.
    expect(contains(result.bytes, new Uint8Array(64).fill(0x5a))).toBe(true);
    expect(result.width).toBe(1200);
    expect(result.height).toBe(1600);
  });
});

describe("QuickTime", () => {
  const original = quicktimeWithLocation();
  const result = scrub(original, sniff(original).format);

  it("turns the location atom into a free box without moving anything", () => {
    expect(result.hadLocation).toBe(true);
    expect(result.bytes.length).toBe(original.length);
    expect(ascii(original).includes("174.7633")).toBe(true);
    expect(ascii(result.bytes).includes("174.7633")).toBe(false);
    expect(ascii(result.bytes).includes("udta")).toBe(false);
    expect(ascii(result.bytes).includes("free")).toBe(true);
    expect(result.durationMs).toBe(6000);
    // mdat, and therefore every sample offset, is exactly where it was.
    expect(result.bytes.subarray(original.length - 128)).toEqual(
      original.subarray(original.length - 128),
    );
  });
});

describe("the repository's own video", () => {
  it("keeps a real MP4 playable and reads its length", () => {
    const bytes = repoFile("public/media/film/no-01-house.mp4");
    const result = scrub(bytes, sniff(bytes).format);
    expect(result.bytes.length).toBe(bytes.length);
    expect(result.durationMs).toBe(6000);
    expect(result.width).toBe(720);
    expect(result.height).toBe(900);
    expect(sniff(result.bytes).format.mime).toBe("video/mp4");
  });
});
