import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The two Varsity faces are display cuts, and each has a smallest size on a
 * screen (the brand pack's fonts note, 12 November 2026):
 *
 *   Varsity Senior   24 px (1.5rem)
 *   Summer Varsity   32 px (2rem)
 *
 * Below the floor a line is set in the label face, DIN Condensed Bold. A
 * class list that sets one of them smaller is a slip that looks fine on a
 * big monitor and turns to mush on a phone, so it is caught here.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const FLOORS = [
  { face: "varsity", name: "Varsity Senior", rem: 1.5 },
  { face: "display", name: "Summer Varsity", rem: 2 },
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx$/.test(name)) out.push(path);
  }
  return out;
}

/** The smallest size a `text-[...]` class can come out at, in rem, if known. */
function smallestRem(value: string): number | null {
  const plain = /^(\d*\.?\d+)rem$/.exec(value);
  if (plain) return Number(plain[1]);
  // clamp(least, preferred, most): it never goes under the first.
  const clamp = /^clamp\((\d*\.?\d+)rem,/.exec(value);
  if (clamp) return Number(clamp[1]);
  // Sized by the screen (the hero): there is no fixed smallest to check.
  return null;
}

/** Every size set beside a face's class in one class list. */
function sizesBeside(face: string, line: string): number[] {
  if (!new RegExp(`(^|[\\s"'\`])${face}(?=[\\s"'\`]|$)`).test(line)) return [];
  const sizes: number[] = [];
  for (const match of line.matchAll(/text-\[([^\]]+)\]/g)) {
    const rem = smallestRem(match[1] ?? "");
    if (rem !== null) sizes.push(rem);
  }
  return sizes;
}

describe("the Varsity faces' smallest sizes", () => {
  it("can see a line set too small", () => {
    expect(
      sizesBeside("varsity", 'className="varsity text-[1.25rem]"'),
    ).toEqual([1.25]);
    expect(
      sizesBeside(
        "varsity",
        'className="varsity mt-2 text-[clamp(2.6rem,13vw,4.75rem)]"',
      ),
    ).toEqual([2.6]);
    // Another face's size is not this face's business.
    expect(sizesBeside("varsity", 'className="label text-[1.05rem]"')).toEqual(
      [],
    );
    // A word that only contains the class name is not the class.
    expect(sizesBeside("display", 'className="displayed text-[1rem]"')).toEqual(
      [],
    );
  });

  it("are kept to, on every screen in the shop and the back end", () => {
    const tooSmall: string[] = [];
    let seen = 0;
    for (const dir of ["app", "components"]) {
      for (const file of walk(join(ROOT, dir))) {
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, index) => {
          for (const floor of FLOORS) {
            for (const rem of sizesBeside(floor.face, line)) {
              seen += 1;
              if (rem < floor.rem) {
                tooSmall.push(
                  `${relative(ROOT, file)}:${String(index + 1)} sets ${floor.name} at ${String(rem)}rem, under its floor of ${String(floor.rem)}rem`,
                );
              }
            }
          }
        });
      }
    }
    expect(tooSmall).toEqual([]);
    // It was looking at something: the faces are set, with a size, in many
    // places, and every one was read.
    expect(seen).toBeGreaterThan(30);
  });
});
