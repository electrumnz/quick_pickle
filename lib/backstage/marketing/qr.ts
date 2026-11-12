/**
 * QR codes for our short links: for a flyer, a poster at the clubrooms, a
 * sign on an event stall.
 *
 * A QR code here only ever holds one of our own short addresses
 * (https://<site>/go/<slug>), so what is printed keeps working if the link
 * is later pointed somewhere new, and every scan is counted like any other
 * click.
 *
 * The squares come from qrcode-generator (Kazuhiko Arase, MIT), which does
 * the real work. This file turns them into the two files a person needs: a
 * vector (SVG), which stays sharp at any size and is what a printer wants,
 * and a PNG for everywhere a vector will not go. The PNG is written here by
 * hand, two colours and one bit a square, so nothing heavier is needed.
 *
 * "QR Code" is a registered trademark of Denso Wave Incorporated.
 */

import { deflateSync } from "node:zlib";

import qrcode from "qrcode-generator";

/**
 * How much of the code can be lost and still read. "Q" survives about a
 * quarter of it going missing: a crease, a coffee ring, a strip of tape.
 */
const ERROR_CORRECTION = "Q" as const;

/** The clear border a scanner needs, in squares. The standard says four. */
export const QUIET_ZONE = 4;

export type QrMatrix = {
  /** Squares along one side, not counting the border. */
  readonly size: number;
  /** True where the square at this row and column is dark. */
  dark(row: number, column: number): boolean;
};

/** The squares for a piece of text. Throws if it is too long to fit. */
export function qrMatrix(text: string): QrMatrix {
  if (text === "" || text.length > 600) {
    throw new Error("A QR code needs between 1 and 600 characters");
  }
  const code = qrcode(0, ERROR_CORRECTION);
  code.addData(text, "Byte");
  code.make();
  const size = code.getModuleCount();
  return { size, dark: (row, column) => code.isDark(row, column) };
}

/**
 * The dark squares as one SVG path, a run of squares at a time, on a grid
 * that includes the border. `side` is the width and height of that grid.
 */
export function qrPath(
  matrix: QrMatrix,
  margin: number = QUIET_ZONE,
): { readonly d: string; readonly side: number } {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    let column = 0;
    while (column < matrix.size) {
      if (!matrix.dark(row, column)) {
        column += 1;
        continue;
      }
      const start = column;
      while (column < matrix.size && matrix.dark(row, column)) column += 1;
      const run = column - start;
      parts.push(
        `M${String(start + margin)} ${String(row + margin)}h${String(run)}v1h-${String(run)}z`,
      );
    }
  }
  return { d: parts.join(""), side: matrix.size + margin * 2 };
}

const HEX = /^#[0-9a-f]{6}$/i;

function assertHex(colour: string): string {
  if (!HEX.test(colour)) throw new Error(`"${colour}" is not a colour`);
  return colour;
}

export type QrColours = {
  /** The squares. Has to be much darker than the ground to scan. */
  readonly dark: string;
  /** The ground and the border round it. */
  readonly light: string;
};

/** A whole SVG file. It has no fixed size: it scales to wherever it is put. */
export function qrSvg(text: string, colours: QrColours): string {
  const { d, side } = qrPath(qrMatrix(text));
  const box = `0 0 ${String(side)} ${String(side)}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="1024" height="1024" shape-rendering="crispEdges">`,
    `<rect width="${String(side)}" height="${String(side)}" fill="${assertHex(colours.light)}"/>`,
    `<path d="${d}" fill="${assertHex(colours.dark)}"/>`,
    `</svg>`,
  ].join("");
}

/* ---- a PNG, by hand ------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
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

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function rgb(colour: string): [number, number, number] {
  const hex = assertHex(colour).slice(1);
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

/**
 * A PNG of the code: two colours, one bit a pixel. `scale` is how many
 * pixels wide each square is; 16 gives an image a little over 600 pixels
 * across for a short link, which prints cleanly at a few centimetres.
 */
export function qrPng(
  text: string,
  colours: QrColours,
  scale = 16,
): Uint8Array {
  if (!Number.isInteger(scale) || scale < 1 || scale > 64) {
    throw new Error("A square is 1 to 64 pixels wide");
  }
  const matrix = qrMatrix(text);
  const squares = matrix.size + QUIET_ZONE * 2;
  const side = squares * scale;
  const rowBytes = Math.ceil(side / 8);

  // Each line: a filter byte (0, none), then the pixels, dark as a 1 bit.
  const raw = new Uint8Array((rowBytes + 1) * side);
  for (let y = 0; y < side; y += 1) {
    const row = Math.floor(y / scale) - QUIET_ZONE;
    const lineStart = y * (rowBytes + 1) + 1;
    if (row < 0 || row >= matrix.size) continue;
    for (let x = 0; x < side; x += 1) {
      const column = Math.floor(x / scale) - QUIET_ZONE;
      if (column < 0 || column >= matrix.size) continue;
      if (!matrix.dark(row, column)) continue;
      const at = lineStart + (x >> 3);
      raw[at] = (raw[at] ?? 0) | (0x80 >> (x & 7));
    }
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, side);
  view.setUint32(4, side);
  header[8] = 1; // bits a pixel
  header[9] = 3; // colours from a palette
  // 10 to 12 stay 0: the only compression and filter there are, not interlaced.

  const palette = new Uint8Array([...rgb(colours.light), ...rgb(colours.dark)]);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", palette),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
