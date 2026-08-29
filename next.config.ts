import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
};

export default nextConfig;
