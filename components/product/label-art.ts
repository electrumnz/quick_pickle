import { LIGHT_PIGMENTS } from "@/lib/brand";
import type { Brine, BrineId } from "@/content/types";

/**
 * The label, drawn as a texture for the 3D bottle.
 *
 * `components/3d` maps u once around the body and v up the label band, so real
 * artwork drops in with no UV work — but the artwork itself does not exist yet:
 * the brand unit's per-SKU label cuts are still to come, and the file the 3D
 * defaults point at is a tuning placeholder that reads "PLACEHOLDER LABEL" in
 * the render. On a page that asks somebody for twenty dollars that is worse
 * than no label at all.
 *
 * So the shop draws its own, from the same records the page is already
 * rendering: the number, the name, the descriptor and the run all come from
 * `content/brines.ts`, and every colour comes from `lib/brand` — which is why
 * there is no hex in this file even though the output is a bitmap.
 *
 * It is a WRAP: the face sits at u = 0.5 and the two flanks carry the run and
 * the volume, so the bottle is labelled from every angle instead of having one
 * good side. Replace `labelArtUri` with the brand unit's real cut the day it
 * lands; nothing else has to change.
 */

const P = LIGHT_PIGMENTS;

/** The foot band, which is the only thing that changes between SKUs. */
const BAND: Readonly<Record<BrineId, string>> = {
  "no-01-house": P.brine.hex,
  "no-02-dirty": P.ink.hex,
  "no-03-smoke": P.chilli.hex,
  "no-04-wild": P.dill.hex,
};

const W = 1200;
const H = 512;

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function labelArtUri(brine: Brine): string {
  const band = BAND[brine.id];
  const run = escapeText(brine.run.join("  ·  ").toUpperCase());
  const name = escapeText(brine.name);
  const descriptor = escapeText(brine.descriptor.toUpperCase());
  const mono = "ui-monospace, 'DejaVu Sans Mono', 'Liberation Mono', monospace";
  const display = "Georgia, 'Liberation Serif', 'Times New Roman', serif";

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${P.paper.hex}"/>`,
    // The two rules that run right around the bottle.
    `<rect x="0" y="34" width="${W}" height="2" fill="${P.ink.hex}"/>`,
    `<rect x="0" y="${H - 96}" width="${W}" height="2" fill="${P.ink.hex}"/>`,
    // The foot band: the SKU's own colour, and the only thing that changes.
    `<rect x="0" y="${H - 60}" width="${W}" height="60" fill="${band}"/>`,
    // The flanks. Set small and kept well outside the face, because the body
    // is a cylinder: type that sits too near the shoulder of the wrap arrives
    // in frame foreshortened and lands on top of the name.
    `<text x="${W * 0.06}" y="${H / 2 + 6}" text-anchor="middle" fill="${P.pepper.hex}" font-family="${mono}" font-size="17" letter-spacing="5" transform="rotate(-90 ${W * 0.06} ${H / 2})">${run}</text>`,
    `<text x="${W * 0.94}" y="${H / 2 + 6}" text-anchor="middle" fill="${P.pepper.hex}" font-family="${mono}" font-size="17" letter-spacing="5" transform="rotate(-90 ${W * 0.94} ${H / 2})">${run}</text>`,
    // The face.
    `<text x="${W / 2}" y="106" text-anchor="middle" fill="${P.ink.hex}" font-family="${mono}" font-size="26" letter-spacing="14">HALF SOUR</text>`,
    `<text x="${W / 2}" y="228" text-anchor="middle" fill="${P.ink.hex}" font-family="${mono}" font-size="86" letter-spacing="10">No. ${brine.number}</text>`,
    `<text x="${W / 2}" y="322" text-anchor="middle" fill="${P.ink.hex}" font-family="${display}" font-size="82" letter-spacing="2">${name}</text>`,
    `<text x="${W / 2}" y="372" text-anchor="middle" fill="${P.pepper.hex}" font-family="${mono}" font-size="22" letter-spacing="8">${descriptor}</text>`,
    `<text x="${W / 2}" y="${H - 68}" text-anchor="middle" fill="${P.ink.hex}" font-family="${mono}" font-size="22" letter-spacing="8">${brine.volumeMl} ML</text>`,
    `</svg>`,
  ].join("");

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
