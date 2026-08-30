import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { servedHere, type PostMedia } from "@/components/admin/data/queries";
import { InstagramFeed, type PreviewPost } from "@/components/admin/social";
import { SURFACES } from "@/lib/social";

/**
 * The picture inside the frame.
 *
 * The preview used to draw an empty rectangle with "Square, 1:1" written in
 * it, because `PostMedia` carried no URL and the seeded library pointed at a
 * CDN that does not exist. It draws the file now, and these are the three
 * things that has to keep being true:
 *
 * **It only draws a file this deployment holds.** {@link servedHere} is the
 * whole gate. A remote URL is not fetched and not rendered, because a broken
 * image icon in a preview reads as a fault in the preview.
 *
 * **A recorded size that is not the file's size is a lie the crop is computed
 * from.** The frame is sized from `width_px`/`height_px` and the picture is
 * drawn into it, so a row whose numbers do not match its bytes would draw a
 * stretched photograph and a crop percentage that is wrong — authoritative and
 * wrong, which is worse than the empty box was. The seed is checked against
 * the actual files on disk below.
 *
 * **The frame keeps everything it did before.** The crop rectangle, the
 * sentence saying what the platform cuts, the missing-alt warning, and the
 * words on a record with no file attached.
 */

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");

/** A JPEG's real dimensions, off its SOF marker. */
function jpegSize(file: string): { width: number; height: number } | null {
  const bytes = readFileSync(file);
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1] ?? 0;
    // Start-of-frame markers, excluding the four that are not frames.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      return {
        height: bytes.readUInt16BE(at + 5),
        width: bytes.readUInt16BE(at + 7),
      };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return null;
}

/** The `content_assets` rows of the seed, as far as this file cares. */
function seededAssets(): {
  slug: string;
  storagePath: string | null;
  publicUrl: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
}[] {
  const seed = readFileSync(
    path.join(REPO_ROOT, "supabase", "seed.sql"),
    "utf8",
  );
  const from = seed.indexOf("insert into public.content_assets");
  const to = seed.indexOf("insert into public.campaigns", from);
  expect(
    from,
    "the content_assets insert is still in the seed",
  ).toBeGreaterThan(-1);
  const block = seed.slice(from, to);
  const row =
    /^\s*\('([a-z0-9-]+)', '[^']*', '\w+', ('[^']*'|null), ('[^']*'|null), ('[^']*'|null), (\d+|null), (\d+|null), (?:\d+|null), (\d+|null),/gm;
  const literal = (value: string): string | null =>
    value === "null" ? null : value.slice(1, -1);
  const number = (value: string): number | null =>
    value === "null" ? null : Number(value);
  return [...block.matchAll(row)].map((match) => ({
    slug: match[1] ?? "",
    storagePath: literal(match[2] ?? "null"),
    publicUrl: literal(match[3] ?? "null"),
    width: number(match[5] ?? "null"),
    height: number(match[6] ?? "null"),
    bytes: number(match[7] ?? "null"),
  }));
}

const SMOKE: PostMedia = {
  title: "No 03 SMOKE, the bottle",
  kind: "image",
  alt: "A 500 ml bottle of No 03 SMOKE on a dark slate bar top, with two dried chillies beside it",
  width: 1024,
  height: 1280,
  seconds: null,
  src: "/media/bottles/no-03-smoke.jpg",
};

function preview(media: PostMedia | null): PreviewPost {
  return {
    text: "No 03 SMOKE is back on Thursday.",
    linkUrl: null,
    media: media === null ? [] : [media],
    handles: { instagram: "halfsour.nz" },
    displayName: "Half Sour",
    whenWords: "Thursday morning",
  };
}

function feed(media: PostMedia | null): string {
  return renderToStaticMarkup(
    <InstagramFeed surface={SURFACES.instagram_feed} post={preview(media)} />,
  );
}

describe("servedHere", () => {
  it("keeps a path this deployment serves", () => {
    expect(servedHere("/media/bottles/no-03-smoke.jpg")).toBe(
      "/media/bottles/no-03-smoke.jpg",
    );
    expect(servedHere("  /media/range/range.jpg  ")).toBe(
      "/media/range/range.jpg",
    );
  });

  it("refuses every host that is not this one", () => {
    // A CDN, a bucket, a protocol-relative URL that looks root-relative at a
    // glance, and a data URI. None of these are files this admin can vouch for.
    expect(
      servedHere("https://cdn.halfsour.co.nz/content/three-up-cream.jpg"),
    ).toBeNull();
    expect(
      servedHere("//cdn.halfsour.co.nz/content/three-up-cream.jpg"),
    ).toBeNull();
    expect(servedHere("media/bottles/no-03-smoke.jpg")).toBeNull();
    expect(servedHere("data:image/gif;base64,R0lGOD")).toBeNull();
  });

  it("answers null for anything that is not a string", () => {
    expect(servedHere(null)).toBeNull();
    expect(servedHere(undefined)).toBeNull();
    expect(servedHere(42)).toBeNull();
    expect(servedHere("")).toBeNull();
  });
});

describe("the seeded library", () => {
  const assets = seededAssets();

  it("parses, and still has the row the decision at the top of Social uses", () => {
    expect(assets.length).toBeGreaterThanOrEqual(8);
    expect(assets.map((asset) => asset.slug)).toContain("no-03-smoke-bottle");
  });

  it("names a file that exists whenever it names a file at all", () => {
    for (const asset of assets) {
      if (asset.publicUrl === null) continue;
      expect(
        servedHere(asset.publicUrl),
        `${asset.slug} is not served here`,
      ).toBe(asset.publicUrl);
      const file = path.join(REPO_ROOT, "public", asset.publicUrl);
      expect(
        existsSync(file),
        `${asset.slug} points at ${asset.publicUrl}`,
      ).toBe(true);
    }
  });

  it("records the size the file actually is", () => {
    for (const asset of assets) {
      if (asset.publicUrl === null) continue;
      const file = path.join(REPO_ROOT, "public", asset.publicUrl);
      expect(statSync(file).size, `${asset.slug} file_size_bytes`).toBe(
        asset.bytes,
      );
      if (!asset.publicUrl.endsWith(".jpg")) continue;
      // The frame is sized from these two numbers and the photograph is drawn
      // into it. Wrong numbers stretch the picture and mis-state the crop.
      expect(jpegSize(file), `${asset.slug} dimensions`).toEqual({
        width: asset.width,
        height: asset.height,
      });
    }
  });

  it("keeps `storage_path` on the rows whose file has not been taken yet", () => {
    // They are real records of intended photography, not junk: the preview
    // draws their shape and says the file is missing. A row with neither a
    // path nor a URL would also fail the schema's own check constraint.
    for (const asset of assets) {
      if (asset.publicUrl !== null) continue;
      if (asset.slug === "restock-copy-smoke") continue; // copy, not a file
      expect(asset.storagePath, `${asset.slug} storage_path`).not.toBeNull();
    }
  });
});

describe("the frame, with a file to draw", () => {
  const markup = feed(SMOKE);

  it("draws the picture", () => {
    expect(markup).toContain("<img");
    expect(markup).toContain("no-03-smoke.jpg");
  });

  it("carries the record's own alt text on the image", () => {
    expect(markup).toContain(`alt="${SMOKE.alt}"`);
  });

  it("does not put an image inside a role=img container", () => {
    // The slot used to be a labelled `div role="img"`. An `<img>` inside one
    // is two images to a screen reader; the figure and its caption do that job
    // now, and axe stays at zero.
    expect(markup).not.toContain('role="img"');
  });

  it("still says exactly what the platform cuts", () => {
    // 1024x1280 into a square: the height goes, a fifth of it, evenly.
    expect(markup).toContain(
      "In Square, 1:1 it loses 20% of its height — 256 pixels, 128 off each edge.",
    );
  });

  it("still draws the crop rectangle to scale over the picture", () => {
    expect(markup).toContain("inline-size:100.00%");
    expect(markup).toContain("block-size:80.00%");
    expect(markup).toContain("Square, 1:1");
  });

  it("still warns when the file has no alt text", () => {
    expect(feed({ ...SMOKE, alt: "" })).toContain("No alt text on this file.");
  });

  it("is still labelled an approximation rather than a screenshot", () => {
    expect(markup).toContain("approximation, not a screenshot");
  });
});

describe("the frame, with nothing to draw", () => {
  it("says the file is not attached, and draws no image", () => {
    const markup = feed({ ...SMOKE, src: null });
    expect(markup).not.toContain("<img");
    expect(markup).toContain("No file is attached to this record yet.");
    // The labelled box, unchanged.
    expect(markup).toContain("Square, 1:1");
    expect(markup).toContain(
      "In Square, 1:1 it loses 20% of its height — 256 pixels, 128 off each edge.",
    );
  });

  it("does not draw a clip as though it were a still", () => {
    const markup = feed({ ...SMOKE, kind: "video", seconds: 22 });
    expect(markup).not.toContain("<img");
    expect(markup).toContain("the record carries no still from it");
  });

  it("does not draw a picture it has no size for", () => {
    // Without dimensions there is no box to draw into, so `cover` would crop
    // to the platform's own ratio and quietly invent a composition.
    const markup = feed({ ...SMOKE, width: null, height: null });
    expect(markup).not.toContain("<img");
    expect(markup).toContain("No size is recorded for this file");
  });

  it("still handles a post with nothing attached at all", () => {
    const markup = feed(null);
    expect(markup).not.toContain("<img");
    expect(markup).toContain("Nothing is attached to this post yet.");
  });
});
