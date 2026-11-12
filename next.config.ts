import { readFileSync, writeFileSync } from "node:fs";
import type { NextConfig } from "next";

/**
 * A private build gets a private tsconfig.
 *
 * `next build` appends `<distDir>/types/**` to the `include` of whichever
 * tsconfig it is pointed at. With `NEXT_DIST_DIR` set (see below) that would
 * leave an entry in the repository's own tsconfig.json for every scratch
 * directory anyone ever built into, so a private build is handed a gitignored
 * copy to scribble on instead.
 */
function prepareScratchTsconfig(): string | null {
  const dist = process.env.NEXT_DIST_DIR;
  if (dist === undefined || dist.trim() === "") return null;
  const name = "tsconfig.scratch.json";
  try {
    let existing: string | null = null;
    try {
      existing = readFileSync(name, "utf8");
    } catch {
      existing = null;
    }
    if (existing === null || !existing.includes('"compilerOptions"')) {
      writeFileSync(name, readFileSync("tsconfig.json", "utf8"));
    }
    return name;
  } catch {
    return null;
  }
}

const scratchTsconfig = prepareScratchTsconfig();

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * PGlite is Postgres compiled to WebAssembly: the database a test, a laptop
   * and a deployment with no DATABASE_URL run on (lib/db/client.ts). It loads
   * its own `.wasm` and `.data` from its package folder at run time, which a
   * bundled copy cannot do, so it is left in node_modules and required from
   * there. With a real database connected nothing imports it at all.
   */
  serverExternalPackages: ["@electric-sql/pglite"],

  /**
   * Where the build lands. `.next` unless something asks for somewhere else.
   *
   * Two `next build`s sharing `.next` do not fail loudly: they interleave, and
   * a `next start` already running then serves HTML that points at CSS the
   * other build deleted. Take a private directory when more than one thing is
   * building this tree:
   *
   *   NEXT_DIST_DIR=.scratch/next-mine npm run build
   *   NEXT_DIST_DIR=.scratch/next-mine npx next start -p 3517
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",

  ...(scratchTsconfig === null
    ? {}
    : { typescript: { tsconfigPath: scratchTsconfig } }),

  /**
   * Where a page that has been drawn again is kept. In the build folder, so
   * it outlasts a restart, unless QP_KEPT_PAGES is "memory".
   *
   * The browser tests ask for memory. They start two servers from ONE build
   * folder, each with its own records, and a kept page says what its own
   * server's shop is selling. Written into the folder they share, a page
   * drawn by one (a price changed, the shop shut) could be served by the
   * other, or by the next run. In memory, each server only ever shows its
   * own. (A deployment keeps its pages wherever its host keeps them, and
   * never sets this.)
   */
  ...(process.env.QP_KEPT_PAGES === "memory"
    ? { experimental: { isrFlushToDisk: false } }
    : {}),

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // A preview of a landing page is shown inside a frame on its own
        // editor page in the back end, so this one path may be framed, by
        // this site and nobody else. Everywhere else stays unframeable.
        source: "/preview/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
      {
        // The art under /brand is content-hashed by nothing, so it is cached
        // for a day and revalidated, not forever.
        source: "/brand/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
