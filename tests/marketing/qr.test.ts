import { inflateSync } from "node:zlib";

import jsQR from "jsqr";
import { describe, expect, it } from "vitest";

import { hexOf } from "@/lib/brand/colours";
import {
  qrMatrix,
  qrPath,
  qrPng,
  qrSvg,
  QUIET_ZONE,
} from "@/lib/backstage/marketing/qr";

/**
 * A QR code that does not scan is worse than none: it gets printed on five
 * hundred flyers first. So these do not check the squares against a picture
 * of the squares. They read each code back with a scanner (jsQR, the reader
 * a phone browser would use) and expect the address that went in.
 */

const LINK = "https://quickpickle.example/go/rovers-clubrooms";
const COLOURS = { dark: hexOf("navy"), light: hexOf("white") };

/** Paint the squares the way a screen or a printer would. */
function paint(text: string, scale: number) {
  const matrix = qrMatrix(text);
  const side = (matrix.size + QUIET_ZONE * 2) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const row = Math.floor(y / scale) - QUIET_ZONE;
      const column = Math.floor(x / scale) - QUIET_ZONE;
      const inside =
        row >= 0 && column >= 0 && row < matrix.size && column < matrix.size;
      if (!inside || !matrix.dark(row, column)) continue;
      pixels.set([34, 35, 92, 255], (y * side + x) * 4);
    }
  }
  return { pixels, side };
}

/** Read our own PNG back: two colours, one bit a pixel, no filter. */
function decodePng(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let width = 0;
  let height = 0;
  let palette: number[] = [];
  const data: Uint8Array[] = [];
  const seen: string[] = [];
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const body = png.subarray(offset + 8, offset + 8 + length);
    seen.push(type);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      // One bit a pixel, colours from a palette, not interlaced.
      expect([...body.subarray(8)]).toEqual([1, 3, 0, 0, 0]);
    }
    if (type === "PLTE") palette = [...body];
    if (type === "IDAT") data.push(body);
    offset += 12 + length;
  }
  expect(seen).toEqual(["IHDR", "PLTE", "IDAT", "IEND"]);
  const raw = inflateSync(Buffer.concat(data));
  const rowBytes = Math.ceil(width / 8);
  expect(raw.length).toBe((rowBytes + 1) * height);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const line = y * (rowBytes + 1);
    expect(raw[line]).toBe(0);
    for (let x = 0; x < width; x += 1) {
      const bit = ((raw[line + 1 + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
      pixels.set(
        [
          palette[bit * 3] ?? 0,
          palette[bit * 3 + 1] ?? 0,
          palette[bit * 3 + 2] ?? 0,
          255,
        ],
        (y * width + x) * 4,
      );
    }
  }
  return { pixels, width, height, palette };
}

describe("QR codes for short links", () => {
  it("scans back to the address that went in", () => {
    const { pixels, side } = paint(LINK, 6);
    expect(jsQR(pixels, side, side)?.data).toBe(LINK);
  });

  it("still scans with a strip torn out of it", () => {
    const { pixels, side } = paint(LINK, 8);
    // A band a tenth of the height, straight through the data: tape, a
    // crease, a marker pen.
    const from = Math.floor(side * 0.55);
    const to = Math.floor(side * 0.65);
    for (let y = from; y < to; y += 1) {
      for (let x = Math.floor(side * 0.3); x < side * 0.9; x += 1) {
        pixels.set([255, 255, 255, 255], (y * side + x) * 4);
      }
    }
    expect(jsQR(pixels, side, side)?.data).toBe(LINK);
  });

  it("writes a PNG a scanner can read, in the brand's navy on white", () => {
    const png = qrPng(LINK, COLOURS, 8);
    const { pixels, width, height, palette } = decodePng(png);
    expect(width).toBe(height);
    expect(width).toBe((qrMatrix(LINK).size + QUIET_ZONE * 2) * 8);
    expect(palette).toEqual([255, 255, 255, 0x22, 0x23, 0x5c]);
    expect(jsQR(pixels, width, height)?.data).toBe(LINK);
    // Small enough to email: one bit a pixel, then squeezed.
    expect(png.length).toBeLessThan(6000);
  });

  it("writes an SVG with a border, one path and nothing else in it", () => {
    const svg = qrSvg(LINK, COLOURS);
    const side = qrMatrix(LINK).size + QUIET_ZONE * 2;
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${String(side)} ${String(side)}"`);
    expect(svg).toContain(`fill="${hexOf("navy")}"`);
    expect(svg).toContain(`fill="${hexOf("white")}"`);
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg).not.toMatch(/<script|href|on\w+=/i);
  });

  it("draws every dark square once, and none in the border", () => {
    const matrix = qrMatrix(LINK);
    const { d, side } = qrPath(matrix);
    expect(side).toBe(matrix.size + QUIET_ZONE * 2);
    let dark = 0;
    for (let row = 0; row < matrix.size; row += 1) {
      for (let column = 0; column < matrix.size; column += 1) {
        if (matrix.dark(row, column)) dark += 1;
      }
    }
    let drawn = 0;
    for (const run of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      const [x, y, width] = [Number(run[1]), Number(run[2]), Number(run[3])];
      expect(x).toBeGreaterThanOrEqual(QUIET_ZONE);
      expect(y).toBeGreaterThanOrEqual(QUIET_ZONE);
      expect(x + width).toBeLessThanOrEqual(side - QUIET_ZONE);
      drawn += width;
    }
    expect(drawn).toBe(dark);
  });

  it("refuses nothing, too much, and a colour that is not one", () => {
    expect(() => qrMatrix("")).toThrow();
    expect(() => qrMatrix("x".repeat(601))).toThrow();
    expect(() => qrSvg(LINK, { dark: "navy", light: "#ffffff" })).toThrow();
    expect(() => qrPng(LINK, COLOURS, 0)).toThrow();
  });
});
