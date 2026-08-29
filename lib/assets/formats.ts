/**
 * What is actually in this file?
 *
 * Upload is the highest-risk surface in the admin, and the whole of its first
 * line of defence is here: **nothing about a file's name or the browser's
 * claimed MIME type is trusted for anything except the wording of an error.**
 * The type is decided by reading the bytes.
 *
 * Three properties this file is built to have:
 *
 *  1. **The allow-list is a list of signatures, not of extensions.** A `.jpg`
 *     that begins `<svg` is not a JPEG, and it is refused. So is a `.png` whose
 *     bytes are HTML, a PDF, a zip, a GIF, or anything else not named below.
 *  2. **SVG is not on the list at all, and cannot be.** An SVG is a document:
 *     it can carry `<script>`, `<foreignObject>` and external references, and a
 *     sanitiser is a filter that has to be right every time against an attacker
 *     who only has to be right once. There is no founder use case for a hand-
 *     written vector here — she is uploading photos off a phone — so the format
 *     is excluded rather than defended. HTML, PDF and GIF are excluded for the
 *     same reason: not needed, so not accepted.
 *  3. **The signature is only the door.** `lib/assets/scrub.ts` then walks the
 *     whole container structurally, and a file that does not parse is refused
 *     before it is ever written to storage.
 *
 * Sizes are capped per file and per upload, and the caps are here rather than
 * in the route handler so the library and the interface cannot disagree.
 */

import { AssetError } from "./errors";
import type { AssetKind } from "./types";

/** One accepted format: what it is, what we call it, what it is for. */
export interface MediaFormat {
  readonly mime: string;
  readonly kind: AssetKind;
  readonly extension: string;
  /** How the admin says it out loud. */
  readonly label: string;
}

export const PHOTO_FORMATS: readonly MediaFormat[] = [
  { mime: "image/jpeg", kind: "photo", extension: "jpg", label: "JPEG photo" },
  { mime: "image/png", kind: "photo", extension: "png", label: "PNG image" },
  { mime: "image/webp", kind: "photo", extension: "webp", label: "WebP image" },
  { mime: "image/avif", kind: "photo", extension: "avif", label: "AVIF image" },
  {
    mime: "image/heic",
    kind: "photo",
    extension: "heic",
    label: "HEIC photo (iPhone)",
  },
];

export const VIDEO_FORMATS: readonly MediaFormat[] = [
  { mime: "video/mp4", kind: "video", extension: "mp4", label: "MP4 video" },
  {
    mime: "video/quicktime",
    kind: "video",
    extension: "mov",
    label: "QuickTime video (iPhone)",
  },
  { mime: "video/webm", kind: "video", extension: "webm", label: "WebM video" },
];

export const ACCEPTED_FORMATS: readonly MediaFormat[] = [
  ...PHOTO_FORMATS,
  ...VIDEO_FORMATS,
];

/** The `accept` attribute for the file input: the same list, no wildcards. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_FORMATS.map(
  (format) => `.${format.extension}`,
)
  .concat(ACCEPTED_FORMATS.map((format) => format.mime))
  .join(",");

export function formatForMime(mime: string): MediaFormat | null {
  return ACCEPTED_FORMATS.find((format) => format.mime === mime) ?? null;
}

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/**
 * A phone photo is 2–8 MB and a 4K burst can reach 25. A minute of 1080p from
 * an iPhone is around 175 MB, so 200 is one long clip and not two.
 */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const MAX_POSTER_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 20;

export function maxBytesFor(kind: AssetKind): number {
  return kind === "photo" ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES;
}

export function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (bytes.length < start + length) return "";
  let text = "";
  for (let index = start; index < start + length; index += 1) {
    text += String.fromCharCode(bytes[index] ?? 0);
  }
  return text;
}

/** ISO base media brands that mean "this is a still image, not a movie". */
const AVIF_BRANDS = new Set(["avif", "avis"]);
const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);
const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso4",
  "iso5",
  "iso6",
  "iso8",
  "mp41",
  "mp42",
  "avc1",
  "dash",
  "mmp4",
  "M4V ",
  "M4VP",
  "3gp4",
  "3gp5",
]);
const QUICKTIME_BRANDS = new Set(["qt  "]);

/** Major brand plus every compatible brand in an `ftyp` box. */
export function isoBrands(bytes: Uint8Array): readonly string[] {
  if (ascii(bytes, 4, 4) !== "ftyp") return [];
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    Math.min(bytes.byteLength, 4096),
  );
  const size = view.getUint32(0);
  const end = Math.min(size < 8 ? 16 : size, bytes.length);
  const brands = [ascii(bytes, 8, 4)];
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    brands.push(ascii(bytes, offset, 4));
  }
  return brands.filter((brand) => brand.trim() !== "" || brand === "qt  ");
}

/**
 * The DocType of an EBML file: `webm` or `matroska`.
 *
 * Only `webm` is accepted. Matroska is the same container with a different
 * profile and it is not on the allow-list, so it is refused by name rather than
 * waved through because the first four bytes matched.
 */
function ebmlDocType(bytes: Uint8Array): string | null {
  const limit = Math.min(bytes.length, 1024);
  for (let index = 0; index + 3 < limit; index += 1) {
    // DocType element id is 0x4282, followed by a one-byte length in practice.
    if (bytes[index] === 0x42 && bytes[index + 1] === 0x82) {
      const length = (bytes[index + 2] ?? 0) & 0x7f;
      if (length > 0 && length < 16 && index + 3 + length <= bytes.length) {
        return ascii(bytes, index + 3, length).replace(/\0+$/, "");
      }
    }
  }
  return null;
}

/** Formats we recognise on sight and refuse, so the message can say why. */
const REFUSED: readonly {
  readonly test: (bytes: Uint8Array) => boolean;
  readonly what: string;
  readonly why: string;
}[] = [
  {
    test: (bytes) => {
      const head = ascii(bytes, 0, 512).trimStart().toLowerCase();
      return head.startsWith("<svg") || head.includes("<svg");
    },
    what: "an SVG",
    why: "an SVG is a document that can carry script, so this library does not accept one at all",
  },
  {
    test: (bytes) => {
      const head = ascii(bytes, 0, 512).trimStart().toLowerCase();
      return head.startsWith("<!doctype html") || head.startsWith("<html");
    },
    what: "an HTML page",
    why: "a web page is not a photo",
  },
  {
    test: (bytes) => startsWith(bytes, [0x25, 0x50, 0x44, 0x46]),
    what: "a PDF",
    why: "PDFs live with the rest of the documents, not in the picture library",
  },
  {
    test: (bytes) =>
      startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
      startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
    what: "a GIF",
    why: "GIF is not on the accepted list — save it as an MP4 or a WebP",
  },
  {
    test: (bytes) => startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]),
    what: "a zip or an office document",
    why: "only photos and video belong here",
  },
];

export interface SniffResult {
  readonly format: MediaFormat;
  /** What the container turned out to be, for the audit line. */
  readonly detail: string;
}

/**
 * Decide what a file is from its first bytes.
 *
 * @throws {AssetError} `unsupported_format` — with a sentence naming what the
 * bytes actually were whenever that is knowable.
 */
export function sniff(bytes: Uint8Array): SniffResult {
  if (bytes.length === 0) {
    throw new AssetError("empty_file", "That file is empty.");
  }

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { format: photo("image/jpeg"), detail: "JPEG (SOI marker)" };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { format: photo("image/png"), detail: "PNG signature" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { format: photo("image/webp"), detail: "RIFF/WEBP" };
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    const docType = ebmlDocType(bytes);
    if (docType === "webm") {
      return { format: video("video/webm"), detail: "EBML DocType webm" };
    }
    throw new AssetError(
      "unsupported_format",
      docType === null
        ? "That looks like a Matroska-family video, and this library only takes WebM, MP4 and QuickTime."
        : `That is a ${docType} file. This library takes WebM, MP4 and QuickTime video.`,
    );
  }

  const brands = isoBrands(bytes);
  if (brands.length > 0) {
    if (brands.some((brand) => AVIF_BRANDS.has(brand))) {
      return { format: photo("image/avif"), detail: `ISO brand ${brands[0]}` };
    }
    if (brands.some((brand) => HEIC_BRANDS.has(brand))) {
      return { format: photo("image/heic"), detail: `ISO brand ${brands[0]}` };
    }
    if (brands.some((brand) => QUICKTIME_BRANDS.has(brand))) {
      return {
        format: video("video/quicktime"),
        detail: "ISO brand qt (QuickTime)",
      };
    }
    if (brands.some((brand) => MP4_BRANDS.has(brand))) {
      return { format: video("video/mp4"), detail: `ISO brand ${brands[0]}` };
    }
    throw new AssetError(
      "unsupported_format",
      `That is an ISO media file of a kind this library does not take (${brands[0] ?? "unknown"}).`,
    );
  }

  for (const refusal of REFUSED) {
    if (refusal.test(bytes)) {
      throw new AssetError(
        "unsupported_format",
        `That file is ${refusal.what} — ${refusal.why}.`,
      );
    }
  }

  throw new AssetError(
    "unsupported_format",
    "Those bytes are not a photo or a video this library recognises. It takes JPEG, PNG, WebP, AVIF and HEIC pictures, and MP4, QuickTime and WebM video.",
  );
}

function photo(mime: string): MediaFormat {
  const format = PHOTO_FORMATS.find((entry) => entry.mime === mime);
  if (format === undefined) throw new Error(`No photo format for ${mime}`);
  return format;
}

function video(mime: string): MediaFormat {
  const format = VIDEO_FORMATS.find((entry) => entry.mime === mime);
  if (format === undefined) throw new Error(`No video format for ${mime}`);
  return format;
}

/**
 * The name and the browser's claimed type, compared against the bytes.
 *
 * The bytes always win. This exists to write a better sentence — "that is a PNG
 * named .jpg" is a much more useful thing to be told than "rejected" — and to
 * refuse the specific case where the two disagree, which is the shape a
 * deliberately mislabelled upload takes.
 *
 * @throws {AssetError} `content_type_mismatch`
 */
export function assertClaimMatches(
  actual: MediaFormat,
  claim: { readonly filename?: string; readonly mimeType?: string },
): void {
  const claimed = claim.mimeType?.toLowerCase().split(";")[0]?.trim() ?? "";
  const extension =
    claim.filename?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

  const extensionAliases: Readonly<Record<string, string>> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    avif: "image/avif",
    heic: "image/heic",
    heif: "image/heic",
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    qt: "video/quicktime",
    webm: "video/webm",
  };

  const namedType = extensionAliases[extension];
  if (namedType !== undefined && namedType !== actual.mime) {
    throw new AssetError(
      "content_type_mismatch",
      `That file is named .${extension} but its contents are ${actual.label.toLowerCase()}. Rename it or export it again — the library goes by what is inside the file, not what it is called.`,
      { claimedExtension: extension, actual: actual.mime },
    );
  }
  if (claimed !== "" && claimed !== actual.mime && formatForMime(claimed)) {
    throw new AssetError(
      "content_type_mismatch",
      `The browser said that file was ${claimed}, and its contents are ${actual.mime}. It was not accepted.`,
      { claimed, actual: actual.mime },
    );
  }
}

/**
 * @throws {AssetError} `file_too_large` / `empty_file`
 */
export function assertSize(bytes: Uint8Array, format: MediaFormat): void {
  if (bytes.length === 0) {
    throw new AssetError("empty_file", "That file is empty.");
  }
  const cap = maxBytesFor(format.kind);
  if (bytes.length > cap) {
    throw new AssetError(
      "file_too_large",
      `That ${format.kind === "photo" ? "photo" : "video"} is ${megabytes(bytes.length)}, and the limit is ${megabytes(cap)}.`,
      { size: bytes.length, cap },
    );
  }
}
