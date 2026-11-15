import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every section's words start and stop at the same two edges on a wide
 * screen: a page (`--container-page`) in the middle, with a gutter either
 * side of it.
 *
 * There are two ways to write that, and they have to come to the same thing:
 *
 *   a box inside somebody else's gutters     max-w-page mx-auto
 *   a box that carries its own gutters       max-w-page-gutters px-gutter mx-auto
 *
 * `max-w-page px-gutter` on one box is neither: it is a page LESS two
 * gutters. It looks right on a phone and on a small laptop, and from about
 * 1,280 wide it sits 64px in from its neighbours. The header, the hero and
 * the ritual did, until 15 November 2026. e2e/site.spec.ts measures the
 * edges in a browser; this catches the slip where it is typed.
 */

const ROOT = join(import.meta.dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx$/.test(name)) out.push(path);
  }
  return out;
}

/** Every quoted or backticked string in a file that holds a class list. */
function classLists(source: string): string[] {
  return [...source.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)]
    .map((found) => found[2] ?? "")
    .filter((text) => /(^|\s)(max-w-page|px-gutter)(\s|$|-)/.test(text));
}

const has = (list: string, name: string) => list.split(/\s+/).includes(name);

describe("the page's width", () => {
  const files = ["app", "components"].flatMap((dir) => walk(join(ROOT, dir)));

  it("is the same for a box that carries its own gutters as for one that does not", () => {
    const slips: string[] = [];
    for (const file of files) {
      for (const list of classLists(readFileSync(file, "utf8"))) {
        if (has(list, "max-w-page") && has(list, "px-gutter")) {
          slips.push(
            `${relative(ROOT, file)}: "max-w-page px-gutter" is a page less two gutters. Use max-w-page-gutters.`,
          );
        }
        if (has(list, "max-w-page-gutters") && !has(list, "px-gutter")) {
          slips.push(
            `${relative(ROOT, file)}: max-w-page-gutters without px-gutter is wider than a page. Use max-w-page.`,
          );
        }
      }
    }
    expect(slips).toEqual([]);
  });

  it("can see both ways of writing it, and would see the slip", () => {
    const all = files.flatMap((file) => classLists(readFileSync(file, "utf8")));
    expect(all.some((list) => has(list, "max-w-page"))).toBe(true);
    expect(all.some((list) => has(list, "max-w-page-gutters"))).toBe(true);
    const slip = classLists(
      '<div className="max-w-page px-gutter mx-auto flex h-14">',
    );
    expect(slip).toHaveLength(1);
    expect(has(slip[0] ?? "", "max-w-page")).toBe(true);
    expect(has(slip[0] ?? "", "px-gutter")).toBe(true);
  });

  it("is a page and two gutters, where a box carries them", () => {
    const tokens = readFileSync(
      join(ROOT, "lib", "brand", "tokens.css"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(tokens).toContain("--container-page: 76rem;");
    expect(tokens).toContain(
      "--container-page-gutters: calc( var(--container-page) + 2 * var(--spacing-gutter) );",
    );
  });
});
