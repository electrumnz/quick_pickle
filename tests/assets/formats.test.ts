/**
 * The door.
 *
 * The acceptance case for this unit is the second block: a file whose bytes do
 * not match its claimed type is rejected. It is tested three ways round — a
 * real PNG renamed to `.jpg`, an SVG with a script in it renamed to `.png`, and
 * an HTML page presented as `image/jpeg` — because those are the three shapes
 * the mistake and the attack both take.
 */

import { describe, expect, it } from "vitest";

import {
  ACCEPTED_FORMATS,
  MAX_PHOTO_BYTES,
  assertClaimMatches,
  assertSize,
  sniff,
} from "@/lib/assets/formats";
import { AssetError } from "@/lib/assets/errors";
import {
  htmlNamedJpeg,
  jpegWithGps,
  pngNamedJpg,
  quicktimeWithLocation,
  repoFile,
  scriptedSvgNamedPng,
  webpWithExif,
} from "./support/fixtures";

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (cause) {
    return cause instanceof AssetError ? cause.code : "not-an-asset-error";
  }
  return "no-error";
}

describe("what the bytes actually are", () => {
  it("recognises every format on the list, from its signature alone", () => {
    expect(sniff(jpegWithGps()).format.mime).toBe("image/jpeg");
    expect(
      sniff(repoFile("public/3d/fallback/bottle-hero.png")).format.mime,
    ).toBe("image/png");
    expect(sniff(webpWithExif()).format.mime).toBe("image/webp");
    expect(sniff(repoFile("public/media/film/range.mp4")).format.mime).toBe(
      "video/mp4",
    );
    expect(sniff(quicktimeWithLocation()).format.mime).toBe("video/quicktime");
  });

  it("lists exactly the formats the brief allows, and no others", () => {
    expect(ACCEPTED_FORMATS.map((format) => format.mime).sort()).toEqual([
      "image/avif",
      "image/heic",
      "image/jpeg",
      "image/png",
      "image/webp",
      "video/mp4",
      "video/quicktime",
      "video/webm",
    ]);
  });
});

describe("a file whose bytes do not match its claimed type", () => {
  it("refuses a PNG named .jpg, and says which is which", () => {
    const { bytes, filename } = pngNamedJpg();
    const { format } = sniff(bytes);
    expect(format.mime).toBe("image/png");
    expect(
      codeOf(() =>
        assertClaimMatches(format, { filename, mimeType: "image/jpeg" }),
      ),
    ).toBe("content_type_mismatch");
    try {
      assertClaimMatches(format, { filename, mimeType: "image/jpeg" });
    } catch (cause) {
      expect(String(cause)).toContain("named .jpg");
      expect(String(cause)).toContain("png image");
    }
  });

  it("refuses an SVG with a script in it, whatever it is called", () => {
    const { bytes, filename } = scriptedSvgNamedPng();
    expect(codeOf(() => sniff(bytes))).toBe("unsupported_format");
    try {
      sniff(bytes);
    } catch (cause) {
      expect(String(cause)).toContain("SVG");
      expect(String(cause)).toContain("script");
    }
    expect(filename).toBe("logo.png");
  });

  it("refuses an HTML page presented as a JPEG", () => {
    const { bytes } = htmlNamedJpeg();
    expect(codeOf(() => sniff(bytes))).toBe("unsupported_format");
  });

  it("refuses the other containers by name: PDF, GIF, zip", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n%stuff");
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3]);
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    for (const bytes of [pdf, gif, zip]) {
      expect(codeOf(() => sniff(bytes))).toBe("unsupported_format");
    }
  });

  it("refuses Matroska even though it shares WebM's first four bytes", () => {
    const header = new Uint8Array(64);
    header.set([0x1a, 0x45, 0xdf, 0xa3], 0);
    header.set([0x42, 0x82, 0x88], 10);
    header.set([...new TextEncoder().encode("matroska")], 13);
    expect(codeOf(() => sniff(header))).toBe("unsupported_format");
    try {
      sniff(header);
    } catch (cause) {
      expect(String(cause)).toContain("matroska");
    }
  });

  it("refuses an empty file", () => {
    expect(codeOf(() => sniff(new Uint8Array(0)))).toBe("empty_file");
  });

  it("accepts a correctly named file, and ignores a browser type that agrees", () => {
    const bytes = jpegWithGps();
    const { format } = sniff(bytes);
    expect(() =>
      assertClaimMatches(format, {
        filename: "IMG_4821.JPG",
        mimeType: "image/jpeg",
      }),
    ).not.toThrow();
    // A browser that sends nothing, or something it made up that is not on the
    // list, is simply ignored: the bytes already decided.
    expect(() =>
      assertClaimMatches(format, { filename: "IMG_4821.jpeg", mimeType: "" }),
    ).not.toThrow();
    expect(() =>
      assertClaimMatches(format, {
        filename: "IMG_4821.jpeg",
        mimeType: "application/octet-stream",
      }),
    ).not.toThrow();
  });
});

describe("size", () => {
  it("caps a photo, and says the number in megabytes", () => {
    const format = sniff(jpegWithGps()).format;
    const huge = new Uint8Array(MAX_PHOTO_BYTES + 1);
    huge.set([0xff, 0xd8, 0xff], 0);
    expect(codeOf(() => assertSize(huge, format))).toBe("file_too_large");
    try {
      assertSize(huge, format);
    } catch (cause) {
      expect(String(cause)).toContain("MB");
    }
  });

  it("lets a normal phone photo through", () => {
    const bytes = jpegWithGps();
    expect(() => assertSize(bytes, sniff(bytes).format)).not.toThrow();
  });
});
