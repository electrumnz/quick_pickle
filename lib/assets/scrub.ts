/**
 * Take the metadata out, and read the shape on the way past.
 *
 * A phone photograph is not just a picture. It carries an EXIF block with the
 * GPS coordinates of where it was taken, to about five metres, plus the camera's
 * serial number and the exact second. A founder posting a photo of her own
 * kitchen should not be publishing her home address, and she should not have to
 * know that in order to be safe from it. So the library does not store the file
 * she chose: it stores a rebuilt file with the metadata containers removed.
 *
 * Four containers, four techniques, one rule — **never re-encode the picture**.
 * Re-encoding would need an image codec, would lose quality, and would change
 * the bytes for no security gain. Instead each format is walked structurally and
 * rebuilt from the parts that are pixels:
 *
 * | Format          | What happens                                              |
 * | --------------- | --------------------------------------------------------- |
 * | JPEG            | Rebuilt from its segments. APP1 (EXIF/XMP), APP13 (IPTC), COM and every other APPn are dropped; APP0 (JFIF) and an ICC profile in APP2 are kept. |
 * | PNG             | Rebuilt from its chunks. Only the critical chunks and a known-safe ancillary set survive; eXIf, tEXt, zTXt, iTXt and tIME are dropped, as is anything unrecognised. |
 * | WebP            | Rebuilt from its RIFF chunks without EXIF and XMP, and the VP8X feature flags for those two are cleared so the file does not claim to have what it no longer has. |
 * | HEIC / AVIF     | The metadata items named by the `meta` box (`Exif`, and `mime` items, which is where XMP lives) have their bytes overwritten with zeros **in place**. Same length, so every other offset in the file stays correct. |
 * | MP4 / QuickTime | `udta` and `meta` boxes — where an iPhone writes `©xyz`, the ISO-6709 latitude and longitude of the recording — are renamed to `free` and zeroed. `free` is the standard "ignore this" box, and because the box keeps its length, the chunk offsets in `stco`/`co64` still point at the right samples and the video still plays. |
 *
 * WebM is the exception and says so: the library does not rewrite Matroska, so a
 * WebM is stored as uploaded and `metadataStripped` is recorded false. Browsers
 * produce WebM from a canvas or a screen recording, which is not a source that
 * carries coordinates; a phone does not produce it at all.
 *
 * The walk is also the file's structural validation. A JPEG that does not parse
 * as a JPEG never reaches storage — the signature check in `formats.ts` is the
 * door, and this is the second lock.
 */

import { AssetError } from "./errors";
import type { MediaFormat } from "./formats";

export interface ScrubResult {
  /** The bytes to store. Never the bytes that were uploaded, for an image. */
  readonly bytes: Uint8Array;
  /** Plain-English list of what was taken out, for the audit line. */
  readonly removed: readonly string[];
  /** True when the original carried coordinates. The coordinates are not kept. */
  readonly hadLocation: boolean;
  /** True when this format is one the library rewrites. */
  readonly stripped: boolean;
  /** When the camera says the shutter fired, if the file said so. */
  readonly capturedAt: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationMs: number | null;
}

export function scrub(bytes: Uint8Array, format: MediaFormat): ScrubResult {
  switch (format.mime) {
    case "image/jpeg":
      return scrubJpeg(bytes);
    case "image/png":
      return scrubPng(bytes);
    case "image/webp":
      return scrubWebp(bytes);
    case "image/avif":
    case "image/heic":
      return scrubIsoImage(bytes);
    case "video/mp4":
    case "video/quicktime":
      return scrubIsoVideo(bytes);
    case "video/webm":
      return {
        bytes,
        removed: [],
        hadLocation: false,
        stripped: false,
        capturedAt: null,
        width: null,
        height: null,
        durationMs: null,
      };
    default:
      throw new AssetError(
        "unsupported_format",
        `No scrubber for ${format.mime}.`,
      );
  }
}

const EMPTY: ScrubResult = {
  bytes: new Uint8Array(0),
  removed: [],
  hadLocation: false,
  stripped: true,
  capturedAt: null,
  width: null,
  height: null,
  durationMs: null,
};

function corrupt(what: string): AssetError {
  return new AssetError(
    "corrupt_file",
    `That file did not read as a complete ${what}, so it was not stored. Try exporting it again.`,
  );
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let text = "";
  for (let index = start; index < start + length && index < bytes.length; ) {
    text += String.fromCharCode(bytes[index] ?? 0);
    index += 1;
  }
  return text;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// EXIF (TIFF) — read the two things worth reading, then throw the block away
// ---------------------------------------------------------------------------

interface ExifFacts {
  readonly hasGps: boolean;
  readonly capturedAt: string | null;
}

const TIFF_GPS_IFD = 0x8825;
const TIFF_EXIF_IFD = 0x8769;
const TIFF_DATE_TIME_ORIGINAL = 0x9003;
const TIFF_DATE_TIME = 0x0132;

/**
 * Read an EXIF/TIFF block far enough to answer two questions: were there
 * coordinates in it, and when was the shutter pressed?
 *
 * The coordinates themselves are deliberately not decoded and never stored. All
 * that survives is the boolean, which is what lets the admin tell the founder
 * "this one had your location in it and we took it out".
 */
export function readExif(tiff: Uint8Array): ExifFacts {
  if (tiff.length < 8) return { hasGps: false, capturedAt: null };
  const order = ascii(tiff, 0, 2);
  if (order !== "II" && order !== "MM") {
    return { hasGps: false, capturedAt: null };
  }
  const little = order === "II";
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (view.getUint16(2, little) !== 42) {
    return { hasGps: false, capturedAt: null };
  }

  let hasGps = false;
  let capturedAt: string | null = null;
  const seen = new Set<number>();

  const readIfd = (offset: number, depth: number): void => {
    if (depth > 3 || offset <= 0 || offset + 2 > tiff.length) return;
    if (seen.has(offset)) return;
    seen.add(offset);
    const count = view.getUint16(offset, little);
    if (count > 512) return;
    for (let index = 0; index < count; index += 1) {
      const entry = offset + 2 + index * 12;
      if (entry + 12 > tiff.length) return;
      const tag = view.getUint16(entry, little);
      const type = view.getUint16(entry + 2, little);
      const valueCount = view.getUint32(entry + 4, little);
      const valueOffset = view.getUint32(entry + 8, little);
      if (tag === TIFF_GPS_IFD) hasGps = true;
      if (tag === TIFF_EXIF_IFD) readIfd(valueOffset, depth + 1);
      if (
        (tag === TIFF_DATE_TIME_ORIGINAL || tag === TIFF_DATE_TIME) &&
        type === 2 &&
        capturedAt === null
      ) {
        const raw =
          valueCount <= 4
            ? ascii(tiff, entry + 8, valueCount)
            : ascii(tiff, valueOffset, Math.min(valueCount, 24));
        capturedAt = parseExifDate(raw);
      }
    }
  };

  readIfd(view.getUint32(4, little), 0);
  return { hasGps, capturedAt };
}

/** `2026:09:14 10:31:08` is EXIF's date format and nobody else's. */
function parseExifDate(raw: string): string | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(
    raw.trim(),
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const iso = `${year ?? ""}-${month ?? ""}-${day ?? ""}T${hour ?? ""}:${minute ?? ""}:${second ?? ""}Z`;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function scrubJpeg(bytes: Uint8Array): ScrubResult {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw corrupt("JPEG");
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  const removed: string[] = [];
  let hadLocation = false;
  let capturedAt: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let sawScan = false;

  let index = 2;
  while (index + 1 < bytes.length) {
    if (bytes[index] !== 0xff) throw corrupt("JPEG");
    let marker = bytes[index + 1] ?? 0;
    // Fill bytes: any number of 0xFF may pad before a marker.
    let cursor = index + 1;
    while (marker === 0xff && cursor + 1 < bytes.length) {
      cursor += 1;
      marker = bytes[cursor] ?? 0;
    }
    if (marker === 0xd9) {
      kept.push(bytes.subarray(index, index + 2));
      index += 2;
      break;
    }
    if (marker === 0xda) {
      // Start of scan: everything from here to the end is entropy-coded data.
      kept.push(bytes.subarray(index));
      sawScan = true;
      index = bytes.length;
      break;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      kept.push(bytes.subarray(index, cursor + 1));
      index = cursor + 1;
      continue;
    }
    const lengthAt = cursor + 1;
    if (lengthAt + 2 > bytes.length) throw corrupt("JPEG");
    const length =
      ((bytes[lengthAt] ?? 0) << 8) | ((bytes[lengthAt + 1] ?? 0) & 0xff);
    if (length < 2) throw corrupt("JPEG");
    const segmentEnd = lengthAt + length;
    if (segmentEnd > bytes.length) throw corrupt("JPEG");
    const payload = bytes.subarray(lengthAt + 2, segmentEnd);

    if (JPEG_SOF_MARKERS.has(marker) && payload.length >= 5) {
      height = ((payload[1] ?? 0) << 8) | (payload[2] ?? 0);
      width = ((payload[3] ?? 0) << 8) | (payload[4] ?? 0);
    }

    let drop = false;
    if (marker === 0xe1) {
      drop = true;
      if (ascii(payload, 0, 4) === "Exif") {
        const facts = readExif(payload.subarray(6));
        hadLocation = hadLocation || facts.hasGps;
        capturedAt = capturedAt ?? facts.capturedAt;
        removed.push(
          facts.hasGps
            ? "EXIF block, including the GPS coordinates"
            : "EXIF block",
        );
      } else {
        const text = ascii(payload, 0, Math.min(payload.length, 4096));
        if (/GPS(Latitude|Longitude)/i.test(text)) hadLocation = true;
        removed.push("XMP metadata");
      }
    } else if (marker === 0xed) {
      drop = true;
      removed.push("Photoshop/IPTC metadata");
    } else if (marker === 0xfe) {
      drop = true;
      removed.push("embedded comment");
    } else if (marker >= 0xe0 && marker <= 0xef) {
      const isJfif = marker === 0xe0;
      const isIcc = marker === 0xe2 && ascii(payload, 0, 11) === "ICC_PROFILE";
      drop = !isJfif && !isIcc;
      if (drop) removed.push(`APP${String(marker - 0xe0)} metadata`);
    }

    if (!drop) kept.push(bytes.subarray(index, segmentEnd));
    index = segmentEnd;
  }

  if (!sawScan) throw corrupt("JPEG");

  return {
    ...EMPTY,
    bytes: concat(kept),
    removed: dedupe(removed),
    hadLocation,
    capturedAt,
    width,
    height,
  };
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

/**
 * Chunks that are pixels, or that describe how to draw them. Everything else —
 * including anything unrecognised — is dropped, because "unknown ancillary
 * chunk" is exactly the shape a metadata smuggler takes.
 */
const PNG_KEEP = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "pHYs",
  "sBIT",
  "bKGD",
  "hIST",
  "acTL",
  "fcTL",
  "fdAT",
  "cICP",
]);

function scrubPng(bytes: Uint8Array): ScrubResult {
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  const removed: string[] = [];
  let hadLocation = false;
  let capturedAt: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let sawEnd = false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let index = 8;
  while (index + 8 <= bytes.length) {
    const length = view.getUint32(index);
    const type = ascii(bytes, index + 4, 4);
    const end = index + 12 + length;
    if (length > bytes.length || end > bytes.length) throw corrupt("PNG");
    const payload = bytes.subarray(index + 8, index + 8 + length);

    if (type === "IHDR" && length >= 8) {
      width = view.getUint32(index + 8);
      height = view.getUint32(index + 12);
    }
    if (type === "eXIf") {
      const facts = readExif(payload);
      hadLocation = hadLocation || facts.hasGps;
      capturedAt = capturedAt ?? facts.capturedAt;
      removed.push(
        facts.hasGps ? "EXIF chunk, including GPS" : "EXIF chunk",
      );
    } else if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
      const text = ascii(payload, 0, Math.min(payload.length, 4096));
      if (/GPS(Latitude|Longitude)/i.test(text)) hadLocation = true;
      removed.push("text metadata chunk");
    } else if (!PNG_KEEP.has(type)) {
      removed.push(`${type} chunk`);
    }

    if (PNG_KEEP.has(type)) kept.push(bytes.subarray(index, end));
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
    index = end;
  }

  if (width === null || !sawEnd) throw corrupt("PNG");

  return {
    ...EMPTY,
    bytes: concat(kept),
    removed: dedupe(removed),
    hadLocation,
    capturedAt,
    width,
    height,
  };
}

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

const WEBP_KEEP = new Set([
  "VP8 ",
  "VP8L",
  "VP8X",
  "ALPH",
  "ANIM",
  "ANMF",
  "ICCP",
]);

function scrubWebp(bytes: Uint8Array): ScrubResult {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  if (riffSize + 8 > bytes.length + 1) throw corrupt("WebP");

  const chunks: Uint8Array[] = [];
  const removed: string[] = [];
  let hadLocation = false;
  let width: number | null = null;
  let height: number | null = null;
  let vp8xPayload: Uint8Array | null = null;
  let sawPixels = false;

  let index = 12;
  while (index + 8 <= bytes.length) {
    const fourcc = ascii(bytes, index, 4);
    const size = view.getUint32(index + 4, true);
    const padded = size + (size % 2);
    const end = index + 8 + padded;
    if (end > bytes.length + 1) throw corrupt("WebP");
    const payload = bytes.subarray(index + 8, index + 8 + size);

    if (fourcc === "VP8X" && size >= 10) {
      vp8xPayload = payload;
      width =
        1 + ((payload[4] ?? 0) | ((payload[5] ?? 0) << 8) | ((payload[6] ?? 0) << 16));
      height =
        1 + ((payload[7] ?? 0) | ((payload[8] ?? 0) << 8) | ((payload[9] ?? 0) << 16));
    }
    if (fourcc === "VP8 " && size >= 10 && width === null) {
      width = ((payload[6] ?? 0) | ((payload[7] ?? 0) << 8)) & 0x3fff;
      height = ((payload[8] ?? 0) | ((payload[9] ?? 0) << 8)) & 0x3fff;
    }
    if (fourcc === "VP8L" && size >= 5 && width === null) {
      const bits =
        (payload[1] ?? 0) |
        ((payload[2] ?? 0) << 8) |
        ((payload[3] ?? 0) << 16) |
        ((payload[4] ?? 0) << 24);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    }
    if (fourcc === "VP8 " || fourcc === "VP8L" || fourcc === "ANMF") {
      sawPixels = true;
    }

    if (fourcc === "EXIF") {
      const facts = readExif(payload);
      hadLocation = hadLocation || facts.hasGps;
      removed.push(facts.hasGps ? "EXIF chunk, including GPS" : "EXIF chunk");
    } else if (fourcc === "XMP ") {
      const text = ascii(payload, 0, Math.min(payload.length, 4096));
      if (/GPS(Latitude|Longitude)/i.test(text)) hadLocation = true;
      removed.push("XMP chunk");
    } else if (!WEBP_KEEP.has(fourcc)) {
      removed.push(`${fourcc.trim()} chunk`);
    }

    if (WEBP_KEEP.has(fourcc)) chunks.push(bytes.subarray(index, end));
    index = end;
  }

  if (!sawPixels || width === null) throw corrupt("WebP");

  // The VP8X header advertises which optional chunks the file has. Having
  // removed EXIF and XMP, clear their bits, or a reader will look for chunks
  // that are not there any more.
  if (vp8xPayload !== null && removed.length > 0) {
    const first = chunks.find((chunk) => ascii(chunk, 0, 4) === "VP8X");
    if (first !== undefined) {
      const copy = first.slice();
      copy[8] = (copy[8] ?? 0) & ~0x0c;
      chunks[chunks.indexOf(first)] = copy;
    }
  }

  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  header.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP

  return {
    ...EMPTY,
    bytes: concat([header, body]),
    removed: dedupe(removed),
    hadLocation,
    width,
    height,
  };
}

// ---------------------------------------------------------------------------
// ISO base media format — HEIC, AVIF, MP4, QuickTime
// ---------------------------------------------------------------------------

interface IsoBox {
  readonly type: string;
  /** Offset of the box header. */
  readonly start: number;
  /** Offset of the first payload byte. */
  readonly bodyStart: number;
  /** Offset one past the last byte of the box. */
  readonly end: number;
}

function* isoBoxes(
  bytes: Uint8Array,
  from: number,
  to: number,
): Generator<IsoBox> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let index = from;
  while (index + 8 <= to) {
    let size = view.getUint32(index);
    const type = ascii(bytes, index + 4, 4);
    let bodyStart = index + 8;
    if (size === 1) {
      if (index + 16 > to) return;
      const high = view.getUint32(index + 8);
      const low = view.getUint32(index + 12);
      size = high * 2 ** 32 + low;
      bodyStart = index + 16;
    } else if (size === 0) {
      size = to - index;
    }
    const end = index + size;
    if (size < 8 || end > to) return;
    yield { type, start: index, bodyStart, end };
    index = end;
  }
}

/** Every box of a given type, at any depth, in document order. */
function findBoxes(
  bytes: Uint8Array,
  from: number,
  to: number,
  wanted: ReadonlySet<string>,
  containers: ReadonlySet<string>,
  depth = 0,
): IsoBox[] {
  if (depth > 6) return [];
  const found: IsoBox[] = [];
  for (const box of isoBoxes(bytes, from, to)) {
    if (wanted.has(box.type)) found.push(box);
    if (containers.has(box.type)) {
      // `meta` is a full box: four bytes of version and flags come before its
      // children. Walking from bodyStart would read those as a box header.
      const from = box.type === "meta" ? box.bodyStart + 4 : box.bodyStart;
      found.push(
        ...findBoxes(bytes, from, box.end, wanted, containers, depth + 1),
      );
    }
  }
  return found;
}

const ISO_IMAGE_CONTAINERS = new Set(["meta", "iprp", "ipco"]);
const ISO_VIDEO_CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl"]);

/**
 * HEIC and AVIF: overwrite the metadata items rather than removing them.
 *
 * A HEIF file is a set of items whose bytes live in `mdat` and whose byte
 * offsets are recorded in `iloc`. Deleting an item would move every offset after
 * it and break the image. Overwriting the item's bytes with zeros — same length,
 * same offsets, same everything else — destroys the metadata and leaves a file
 * every decoder still reads.
 */
function scrubIsoImage(bytes: Uint8Array): ScrubResult {
  const out = bytes.slice();
  const removed: string[] = [];
  let hadLocation = false;
  let capturedAt: string | null = null;

  const meta = [...isoBoxes(out, 0, out.length)].find(
    (box) => box.type === "meta",
  );
  if (meta === undefined) throw corrupt("HEIC or AVIF image");

  // `meta` is a full box: skip its version and flags before reading children.
  const metaBody = meta.bodyStart + 4;
  const children = [...isoBoxes(out, metaBody, meta.end)];
  const iinf = children.find((box) => box.type === "iinf");
  const iloc = children.find((box) => box.type === "iloc");
  const idat = children.find((box) => box.type === "idat");
  if (iinf === undefined || iloc === undefined) throw corrupt("HEIC image");

  const itemTypes = readItemInfo(out, iinf);
  const locations = readItemLocations(out, iloc);

  for (const [itemId, type] of itemTypes) {
    if (type !== "Exif" && type !== "mime") continue;
    for (const extent of locations.get(itemId) ?? []) {
      const base =
        extent.constructionMethod === 1
          ? (idat?.bodyStart ?? 0) + extent.offset
          : extent.offset;
      const end = Math.min(base + extent.length, out.length);
      if (base < 0 || base >= out.length || end <= base) continue;
      const payload = out.subarray(base, end);
      if (type === "Exif") {
        // An Exif item begins with a four-byte offset to the TIFF header.
        const tiffStart = 4 + readUint32(payload, 0);
        const facts = readExif(payload.subarray(Math.min(tiffStart, payload.length)));
        hadLocation = hadLocation || facts.hasGps;
        capturedAt = capturedAt ?? facts.capturedAt;
        removed.push(facts.hasGps ? "EXIF item, including GPS" : "EXIF item");
      } else {
        const text = ascii(payload, 0, Math.min(payload.length, 4096));
        if (/GPS(Latitude|Longitude)|exif:GPS/i.test(text)) hadLocation = true;
        removed.push("XMP item");
      }
      out.fill(0, base, end);
    }
  }

  const ispe = findBoxes(
    out,
    0,
    out.length,
    new Set(["ispe"]),
    ISO_IMAGE_CONTAINERS,
  )[0];
  const width = ispe === undefined ? null : readUint32(out, ispe.bodyStart + 4);
  const height = ispe === undefined ? null : readUint32(out, ispe.bodyStart + 8);

  return {
    ...EMPTY,
    bytes: out,
    removed: dedupe(removed),
    hadLocation,
    capturedAt,
    width: width === null || width === 0 ? null : width,
    height: height === null || height === 0 ? null : height,
  };
}

/**
 * MP4 and QuickTime: rename the metadata boxes to `free` and zero them.
 *
 * `free` is the container's own "skip me" box, so this is a rewrite every
 * parser already understands. Because the box keeps its length, the sample
 * offsets in `stco`/`co64` — which are absolute file offsets — still point at
 * the right bytes, and the video plays exactly as it did.
 */
function scrubIsoVideo(bytes: Uint8Array): ScrubResult {
  const out = bytes.slice();
  const removed: string[] = [];
  let hadLocation = false;

  const targets = findBoxes(
    out,
    0,
    out.length,
    new Set(["udta", "meta", "uuid"]),
    ISO_VIDEO_CONTAINERS,
  );
  for (const box of targets) {
    const payload = out.subarray(box.bodyStart, box.end);
    const text = ascii(payload, 0, Math.min(payload.length, 8192));
    if (
      /©xyz|loci|location|GPSCoordinates/i.test(text) ||
      /com\.apple\.quicktime\.location/i.test(text)
    ) {
      hadLocation = true;
    }
    removed.push(
      box.type === "udta"
        ? "user-data box (where a phone writes the recording location)"
        : `${box.type} metadata box`,
    );
    // Rewrite the four type bytes to "free", then blank the payload.
    out.set([0x66, 0x72, 0x65, 0x65], box.start + 4);
    out.fill(0, box.bodyStart, box.end);
  }

  const [mvhd] = findBoxes(
    out,
    0,
    out.length,
    new Set(["mvhd"]),
    ISO_VIDEO_CONTAINERS,
  );
  const [tkhd] = findBoxes(
    out,
    0,
    out.length,
    new Set(["tkhd"]),
    ISO_VIDEO_CONTAINERS,
  );

  let durationMs: number | null = null;
  if (mvhd !== undefined) {
    const version = out[mvhd.bodyStart] ?? 0;
    const base = mvhd.bodyStart + 4;
    if (version === 1) {
      const timescale = readUint32(out, base + 16);
      const high = readUint32(out, base + 20);
      const low = readUint32(out, base + 24);
      const duration = (high ?? 0) * 2 ** 32 + (low ?? 0);
      if (timescale) durationMs = Math.round((duration / timescale) * 1000);
    } else {
      const timescale = readUint32(out, base + 8);
      const duration = readUint32(out, base + 12);
      if (timescale && duration !== null) {
        durationMs = Math.round((duration / timescale) * 1000);
      }
    }
  }

  let width: number | null = null;
  let height: number | null = null;
  if (tkhd !== undefined) {
    const version = out[tkhd.bodyStart] ?? 0;
    const end = tkhd.end;
    const widthAt = version === 1 ? end - 8 : end - 8;
    const fixedWidth = readUint32(out, widthAt);
    const fixedHeight = readUint32(out, widthAt + 4);
    if (fixedWidth !== null && fixedHeight !== null) {
      width = Math.round(fixedWidth / 65536) || null;
      height = Math.round(fixedHeight / 65536) || null;
    }
  }

  if (mvhd === undefined) throw corrupt("MP4 or QuickTime video");

  return {
    ...EMPTY,
    bytes: out,
    removed: dedupe(removed),
    hadLocation,
    width,
    height,
    durationMs: durationMs !== null && durationMs > 0 ? durationMs : null,
  };
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return 0;
  return (
    ((bytes[offset] ?? 0) << 24) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) return 0;
  return ((bytes[offset] ?? 0) << 8) + (bytes[offset + 1] ?? 0);
}

/** `iinf` → item id to item type (`Exif`, `mime`, `hvc1`, `av01` …). */
function readItemInfo(bytes: Uint8Array, iinf: IsoBox): Map<number, string> {
  const types = new Map<number, string>();
  const version = bytes[iinf.bodyStart] ?? 0;
  let cursor = iinf.bodyStart + 4;
  cursor += version === 0 ? 2 : 4;
  for (const entry of isoBoxes(bytes, cursor, iinf.end)) {
    if (entry.type !== "infe") continue;
    const entryVersion = bytes[entry.bodyStart] ?? 0;
    const body = entry.bodyStart + 4;
    if (entryVersion >= 2) {
      const idSize = entryVersion === 2 ? 2 : 4;
      const itemId =
        idSize === 2 ? readUint16(bytes, body) : readUint32(bytes, body);
      const itemType = ascii(bytes, body + idSize + 2, 4);
      types.set(itemId, itemType);
    }
  }
  return types;
}

interface ItemExtent {
  readonly offset: number;
  readonly length: number;
  readonly constructionMethod: number;
}

/** `iloc` → item id to the byte ranges its content occupies. */
function readItemLocations(
  bytes: Uint8Array,
  iloc: IsoBox,
): Map<number, ItemExtent[]> {
  const locations = new Map<number, ItemExtent[]>();
  const version = bytes[iloc.bodyStart] ?? 0;
  let cursor = iloc.bodyStart + 4;

  const sizes = bytes[cursor] ?? 0;
  const offsetSize = sizes >> 4;
  const lengthSize = sizes & 0x0f;
  const sizes2 = bytes[cursor + 1] ?? 0;
  const baseOffsetSize = sizes2 >> 4;
  const indexSize = version === 1 || version === 2 ? sizes2 & 0x0f : 0;
  cursor += 2;

  let itemCount: number;
  if (version < 2) {
    itemCount = readUint16(bytes, cursor);
    cursor += 2;
  } else {
    itemCount = readUint32(bytes, cursor);
    cursor += 4;
  }
  if (itemCount > 4096) return locations;

  const readSized = (at: number, size: number): number => {
    if (size === 0) return 0;
    if (size === 4) return readUint32(bytes, at);
    if (size === 8) return readUint32(bytes, at) * 2 ** 32 + readUint32(bytes, at + 4);
    if (size === 2) return readUint16(bytes, at);
    return 0;
  };

  for (let index = 0; index < itemCount; index += 1) {
    if (cursor >= iloc.end) break;
    let itemId: number;
    if (version < 2) {
      itemId = readUint16(bytes, cursor);
      cursor += 2;
    } else {
      itemId = readUint32(bytes, cursor);
      cursor += 4;
    }
    let constructionMethod = 0;
    if (version === 1 || version === 2) {
      constructionMethod = readUint16(bytes, cursor) & 0x0f;
      cursor += 2;
    }
    cursor += 2; // data_reference_index
    const baseOffset = readSized(cursor, baseOffsetSize);
    cursor += baseOffsetSize;
    const extentCount = readUint16(bytes, cursor);
    cursor += 2;
    const extents: ItemExtent[] = [];
    for (let extent = 0; extent < extentCount && cursor < iloc.end; extent += 1) {
      cursor += indexSize;
      const offset = readSized(cursor, offsetSize);
      cursor += offsetSize;
      const length = readSized(cursor, lengthSize);
      cursor += lengthSize;
      extents.push({
        offset: baseOffset + offset,
        length,
        constructionMethod,
      });
    }
    locations.set(itemId, extents);
  }
  return locations;
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
