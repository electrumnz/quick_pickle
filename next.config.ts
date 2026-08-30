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
