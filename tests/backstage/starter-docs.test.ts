import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, normalize } from "node:path";

import * as prettier from "prettier";
import { describe, expect, it } from "vitest";

import {
  LIVE_SITE,
  STARTER_DOCS_DIR,
  starterDocFiles,
} from "@/lib/backstage/plans/starter/export";

/**
 * docs/starter: the drafts the back end starts with, as files to read in
 * the repository (lib/backstage/plans/starter/export.ts).
 *
 * The files are made from the same data the back end loads, so there is one
 * source. This test is what keeps them from drifting: it fails when the
 * folder is not exactly what the source makes. `npm run docs:export` runs
 * this same file with QP_WRITE_DOCS=1, which writes the folder first.
 */

const ROOT = process.cwd();
const FOLDER = join(ROOT, STARTER_DOCS_DIR);
const WRITE = process.env.QP_WRITE_DOCS === "1";
const HOW = "Run `npm run docs:export` and commit what it writes.";

/** Every file, run through the repository's own formatter. */
async function made(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const file of starterDocFiles()) {
    const full = join(FOLDER, file.path);
    const config = await prettier.resolveConfig(full);
    out.set(
      file.path,
      await prettier.format(file.markdown, { ...config, filepath: full }),
    );
  }
  return out;
}

/** Every file under a folder, as paths from that folder, in order. */
function filesUnder(folder: string, prefix = ""): string[] {
  if (!existsSync(folder)) return [];
  const out: string[] = [];
  for (const name of readdirSync(folder).sort()) {
    const full = join(folder, name);
    const path = prefix === "" ? name : `${prefix}/${name}`;
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, path));
    else out.push(path);
  }
  return out;
}

describe("the starter drafts, as files", () => {
  it("are exactly what the source makes, with nothing left over", async () => {
    const files = await made();

    if (WRITE) {
      for (const stale of filesUnder(FOLDER)) {
        if (!files.has(stale)) rmSync(join(FOLDER, stale));
      }
      for (const [path, markdown] of files) {
        const full = join(FOLDER, path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, markdown);
      }
    }

    expect(filesUnder(FOLDER), HOW).toEqual([...files.keys()].sort());
    for (const [path, markdown] of files) {
      expect(readFileSync(join(FOLDER, path), "utf8"), `${path}: ${HOW}`).toBe(
        markdown,
      );
    }
  });

  it("cover every list and every draft the back end starts with", async () => {
    const paths = [...(await made()).keys()];
    expect(paths).toEqual(
      expect.arrayContaining([
        "README.md",
        "QUESTIONS.md",
        "COMPLIANCE.md",
        "COSTS.md",
        "how-to/how-to-pack-an-order.md",
        "plans/business-plan.md",
        "policies/policy-reviews.md",
      ]),
    );
    expect(paths.filter((path) => path.startsWith("how-to/")).length).toBe(12);
    expect(paths.filter((path) => path.startsWith("plans/")).length).toBe(3);
    expect(paths.filter((path) => path.startsWith("policies/")).length).toBe(2);
  });

  it("link only to each other and to the back end's own screens", async () => {
    const files = await made();
    let links = 0;
    for (const [path, markdown] of files) {
      for (const match of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
        const address = match[1] ?? "";
        links += 1;
        if (/^https?:/.test(address)) {
          // A screen of the back end, at the shop's own address. (A draft
          // may also name a regulator's site: those are left as written.)
          if (address.startsWith(LIVE_SITE)) {
            expect(address, path).toMatch(
              new RegExp(`^${LIVE_SITE}/backstage(/|#|$)`),
            );
          }
          continue;
        }
        if (address.startsWith("mailto:") || address.startsWith("#")) continue;
        // Anything else is one of these files, from where this one sits.
        const target = normalize(
          join(dirname(path), address.split("#")[0] ?? ""),
        )
          .split("\\")
          .join("/");
        expect(files.has(target), `${path} links to ${address}`).toBe(true);
      }
      // Nothing is left pointing at an address only the site understands.
      expect(markdown, path).not.toMatch(/\]\(\/[^)]*\)/);
    }
    expect(links).toBeGreaterThan(50);
  });

  it("say at the top that the back end holds the working copy", async () => {
    for (const [path, markdown] of await made()) {
      expect(markdown.split("\n")[0], path).toMatch(/npm run docs:export/);
      if (path === "README.md") continue;
      expect(markdown, path).toMatch(/This file does not follow those changes/);
    }
  });
});
