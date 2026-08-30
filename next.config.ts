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
     * The default is WebP alone. Every image on this site is now a
     * photograph rather than a flat drawing, and AVIF is materially smaller
     * than WebP on exactly that content. Browsers that cannot read it fall
     * back through the list on their own `Accept` header, so there is
     * nothing to feature-detect.
     */
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
