import { readFileSync, writeFileSync } from "node:fs";
import type { NextConfig } from "next";

import { isDemoMode } from "./lib/demo/mode";

/**
 * Derive the private tsconfig for a private build directory, and return its
 * path. Null when NEXT_DIST_DIR is unset, which is the ordinary case.
 *
 * It is a copy rather than an `extends`, because Next rewrites the `include`
 * of the file it is given and an `extends` child would then carry a partial
 * include that shadows the parent's.
 */
function prepareScratchTsconfig(): string | null {
  const dist = process.env.NEXT_DIST_DIR;
  if (dist === undefined || dist.trim() === "") return null;
  const name = "tsconfig.scratch.json";
  try {
    const base = readFileSync("tsconfig.json", "utf8");
    let existing: string | null = null;
    try {
      existing = readFileSync(name, "utf8");
    } catch {
      existing = null;
    }
    // Only rewrite when the base has moved on, so Next's own appends survive
    // between builds in the same scratch directory.
    if (existing === null || !existing.includes('"compilerOptions"')) {
      writeFileSync(name, base);
    }
    return name;
  } catch {
    // A missing or unreadable tsconfig is not this file's problem to report.
    return null;
  }
}

const scratchTsconfig = prepareScratchTsconfig();

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * PGlite is Postgres compiled to WebAssembly. It loads its own `.wasm` and
   * `.data` from its package directory at runtime, which a bundled copy cannot
   * do, so it stays external and is required from `node_modules` on the server.
   * Listing it is harmless when demo mode is off: nothing imports it then, and
   * the import that exists is dynamic.
   */
  serverExternalPackages: ["@electric-sql/pglite"],

  /**
   * The demo database image is read with `fs` at runtime, so Next's tracer
   * cannot see it from the import graph and has to be told. The glob matches
   * nothing when demo mode is off, which is not an error.
   */
  outputFileTracingIncludes: {
    "/**/*": ["./lib/demo/generated/**"],
  },

  /**
   * `X-Robots-Tag` on every response in demo mode.
   *
   * The third and broadest of the three noindex layers — `app/layout.tsx` sets
   * the meta tag and `app/robots.ts` disallows everything, but a meta tag only
   * reaches HTML and robots.txt is only a request. A header covers the JSON,
   * the images and the feeds too, and a crawler that has already fetched a URL
   * still honours it.
   */
  async headers() {
    if (!isDemoMode()) return [];
    return [
      {
        source: "/:path*",
        headers: [
          { key: "x-robots-tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
  /**
   * Where the build lands. `.next` unless something asks for somewhere else.
   *
   * This exists because more than one agent works this tree at once, and two
   * `next build`s sharing `.next` do not fail loudly — they interleave, and a
   * `next start` already running against the old build then serves HTML whose
   * asset manifest points at CSS files the new build has deleted. The page
   * comes back with no stylesheet at all, which looks like a styling bug and
   * is not one. Set NEXT_DIST_DIR to take a private build directory:
   *
   *   NEXT_DIST_DIR=.scratch/next-home npm run build
   *   NEXT_DIST_DIR=.scratch/next-home npx next start -p 3517
   *
   * `.scratch/` is already gitignored. Unset, nothing changes for anyone.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",

  /**
   * Where Next writes its generated type globs.
   *
   * `next build` appends `<distDir>/types/**` to the `include` of whichever
   * tsconfig it is pointed at, and it does a literal string comparison, so a
   * wildcard cannot pre-satisfy it. With a private NEXT_DIST_DIR per agent
   * that meant the repository's own tsconfig.json collected an entry per
   * scratch directory — nineteen of them at the last count, plus a reformat —
   * and every one of them had to be reverted by hand before committing.
   *
   * A private build therefore gets a private tsconfig to scribble on. It lives
   * at the repository root, NOT inside `.scratch/`, because `include` and
   * `paths` resolve relative to the directory holding the config file; moving
   * it down a level would silently repoint every one of them.
   *
   * Unset NEXT_DIST_DIR and this is not set either, so the ordinary build and
   * every editor still use tsconfig.json exactly as before.
   */
  ...(scratchTsconfig === null ? {} : { typescript: { tsconfigPath: scratchTsconfig } }),

  images: {
    /**
     * Next 16 serves `quality` only from a fixed allow-list, so that a
     * stranger cannot fill the image cache with arbitrary variants by
     * guessing at the query string. The consequence is quiet: a `quality`
     * a component asks for and this list does not carry is not an error,
     * it is served at the default instead. `components/home/Hero.tsx` asks
     * for 58, and until now got 75.
     */
    qualities: [58, 75],
    /**
     * WebP alone, which is also the default — written out because the
     * obvious change here is wrong, and should not be made again without a
     * clean measurement.
     *
     * AVIF is genuinely half the bytes at every width on this photography,
     * measured by fetching both: 5.2KB against 10.4KB at w=640, 12.5
     * against 24.7 at 1200, 18.5 against 35.8 at 3840. It still scored
     * worse. Five Lighthouse runs against each, same build, same machine,
     * same minute:
     *
     *                perf median    LCP      TBT    image
     *   AVIF+WebP       0.91       3.04s    216ms    9KB
     *   WebP only       0.93       3.17s     93ms   15KB
     *
     * Half the bytes, slightly better LCP, and more than double the
     * blocking time — AVIF decodes slowly under Lighthouse's 4x CPU
     * throttle, and the score follows blocking time here. The AVIF spread
     * was also wide (0.84-0.94 against 0.91-0.93), which on a machine
     * running four other builds is a reason to distrust the number rather
     * than to average it.
     *
     * So this is a hold, not a verdict. Real phones decode better than the
     * throttle implies and pay worse for bytes, so AVIF may well win for
     * actual customers while losing the audit. Re-measure on a quiet
     * machine before deciding. Neither setting reaches the 0.95 CI gate.
     */
    formats: ["image/webp"],
  },
};

export default nextConfig;
