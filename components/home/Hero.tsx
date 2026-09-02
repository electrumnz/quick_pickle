import Image from "next/image";
import Link from "next/link";

import { RANGE_SHOT } from "@/components/product/media";
import { HERO_SERVE_LINE } from "@/components/site/copy";

import { HOME } from "./data";
import { cx } from "./cx";
import styles from "./home.module.css";

/**
 * The hero: the range photograph, full bleed, and under it the one sentence
 * that has to survive on its own, the serve line, and the two routes in.
 *
 * A server component with no client part. It used to be a 260vh scroll-scrub
 * over a still that zoomed 16 per cent, with a custom cursor and a smooth
 * scroll library underneath it, and the two buttons under the fold at every
 * common size. All of that is gone: the plate is cropped rather than framed
 * (see `.heroPhoto` in home.module.css for the crop and the reasoning), the
 * band beneath is on the first screen at 1440x900 and 390x844, and the only
 * motion is the plate settling once on load.
 *
 * The wordmark is the page's h1 — drawn geometry loaded as a CSS mask, so it
 * takes its colour from the type around it. The mask sits on an inner span
 * so the heading role survives; e2e/smoke.spec.ts asserts a level-1 heading
 * named "Half Sour".
 */
export function Hero() {
  return (
    <section aria-label="Half Sour">
      <div className={cx(styles.heroPhoto)} data-hero-art>
        {/* The plate drifts a little slower than the page as you scroll
            past it — differential movement, the cheapest depth there is —
            and it is cut oversize so the drift never shows an edge. The
            rate is a fraction of the parallax token, which is 0px under
            reduced motion, so there is no reduced branch to write. */}
        <div className={cx(styles.heroArtLayer)} data-parallax="0.5">
          <Image
            src={RANGE_SHOT.still}
            alt={RANGE_SHOT.alt}
            fill
            // The LCP element on this page: fetched at high priority, never
            // lazily. `sizes` is the honest number — the plate is the viewport
            // wide at every width.
            priority
            fetchPriority="high"
            // Decoded on the main thread in the paint that first draws it,
            // rather than off-thread and painted a frame or two later. On a
            // slow CPU the "later" landed behind hydration, and Lighthouse
            // counted the largest paint a second after the image had loaded.
            decoding="sync"
            quality={58}
            sizes="100vw"
            className={cx(styles.heroArt)}
          />
        </div>
      </div>

      <div className="px-gutter">
        <div className={cx(styles.heroBand, "max-w-page mx-auto")}>
          <div className="max-w-prose">
            <h1>
              <span
                className={cx(
                  styles.wordmark,
                  styles.heroWordmark,
                  "text-primary",
                )}
                role="img"
                aria-label="HALF SOUR"
              />
            </h1>
            <p className="text-lede text-primary mt-block" data-hero-line>
              {HOME.hero.line}
            </p>
            {/* The serve, named in the first screen: a stranger who reads
                three lines without meeting a drink files the bottle in the
                supplement aisle. lib/strategy/audit.ts measures this. */}
            <p className="text-body text-muted mt-stack">{HERO_SERVE_LINE}</p>
          </div>

          <div className="gap-stack flex flex-wrap items-center lg:justify-end">
            <Link
              href={HOME.hero.shop.href}
              className={cx(styles.button, styles.buttonPrimary)}
            >
              {HOME.hero.shop.label}
            </Link>
            <Link
              href={HOME.hero.recipes.href}
              className={cx(styles.button, styles.buttonSecondary)}
            >
              {HOME.hero.recipes.label}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
