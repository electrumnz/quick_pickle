import { Buy } from "@/components/home/Buy";
import { Cursor } from "@/components/home/Cursor";
import { Hero } from "@/components/home/Hero";
import { MotionRoot } from "@/components/home/MotionRoot";
import { SiteFooter } from "@/components/home/SiteFooter";
import { SiteHeader } from "@/components/home/SiteHeader";
import {
  ALL_BRINES,
  brineLabel,
  FULL_SET,
  KITCHEN,
  PROCESS,
  price,
  SEAL_TONE,
  productHref,
  SERVES,
  SPEC_FIGURES,
  volume,
  type SealTone,
} from "@/components/home/data";
import { isLive } from "@/components/home/routes";
import { cx } from "@/components/home/cx";
import styles from "@/components/home/home.module.css";
import { signupParams } from "@/components/site/SignupForm";

/**
 * HALF SOUR — the homepage.
 *
 * A rendering of `components/home/data.ts` and `content/brines.ts` and nothing
 * else: no page in this build carries copy of its own, so the copy auditor
 * scans the data layer once and the founder edits it in one place.
 *
 * The sections are the five the nav names — the hero, the range, what it is
 * for, how it is made, and the route to buy. Everything under [data-reveal]
 * starts visible and is hidden by MotionRoot in JavaScript on the way in,
 * which is what keeps the page whole with scripting switched off.
 *
 * ## Why this page reads `searchParams`
 *
 * The list sign-up in the Buy section is a plain `<form>` posting to a Server
 * Action, and the action answers by redirecting back here with the outcome in
 * the query string. That is what makes the form work with JavaScript switched
 * off — no client component, no optimistic state, no toast that a browser
 * without script never shows. The cost is that this route renders per request
 * rather than being prerendered. It reads nothing from a database and nothing
 * from the network, so what that buys the visitor is a confirmation they can
 * actually see; what it costs is a render.
 */

const SEAL_CLASS: Readonly<Record<SealTone, string | undefined>> = {
  accent: styles.toneAccent,
  inverse: styles.toneInverse,
  danger: styles.toneDanger,
  secondary: styles.toneSecondary,
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const signup = signupParams((key) => first(params[key]));

  return (
    <>
      <MotionRoot />
      {/* Mounts nothing on a coarse pointer: see components/home/Cursor.tsx.
          Every word it shows is also in the markup, so a phone loses a
          flourish and no information. */}
      <Cursor />
      <SiteHeader />

      <main id="top">
        <Hero />

        {/* ------------------------------------------------------- range */}
        <section
          id="range"
          aria-labelledby="range-heading"
          data-reveal-group
          className="px-gutter py-section"
        >
          <div className="max-w-page mx-auto">
            <header className="max-w-prose" data-reveal>
              <p className="text-eyebrow text-muted font-mono uppercase">
                The range
              </p>
              <h2
                id="range-heading"
                className="text-display-3 text-primary mt-stack"
              >
                Four brines.
              </h2>
            </header>

            <div className="mt-block">
              {ALL_BRINES.map((b) => (
                <article key={b.id} className={cx(styles.row)} data-reveal>
                  <div className="gap-inline flex items-center">
                    <span
                      className={cx(styles.seal, SEAL_CLASS[SEAL_TONE[b.id]])}
                      aria-hidden="true"
                    />
                    <span
                      className={cx(
                        styles.figure,
                        "text-mono text-muted uppercase",
                      )}
                    >
                      No. {b.number}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-heading-3 text-primary">{b.name}</h3>
                    <p className="text-body-sm text-muted mt-1">
                      {b.descriptor}
                    </p>
                    <p className="text-body text-primary mt-stack max-w-prose">
                      {b.line}
                    </p>
                  </div>

                  {/* The tasting notes only earn their column at 1280+; below
                      that the grid is three columns and this one is removed
                      from it entirely rather than wrapping to a second row. */}
                  <div className="hidden xl:block">
                    <ul className="gap-inline flex flex-col">
                      {b.notes.map((note) => (
                        <li key={note} className="text-body-sm text-muted">
                          {note}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="md:text-right">
                    <p
                      className={cx(
                        styles.figure,
                        "text-heading-3 text-primary",
                      )}
                    >
                      {price(b.priceNzd)}
                    </p>
                    <p
                      className={cx(
                        styles.figure,
                        "text-caption text-muted mt-1",
                      )}
                    >
                      {volume(b.volumeMl)}
                    </p>
                    {b.supplyLimited ? (
                      <p className="text-caption text-muted mt-stack">
                        Limited by leaf supply.
                      </p>
                    ) : null}
                    {/* The product page is linked the moment it exists and
                        not a day before — routes.ts is the single place that
                        knows. Until then the row still states the price and
                        the Buy section below states how to get one. */}
                    {isLive({ href: productHref(b.id), label: b.name }) ? (
                      <a
                        href={productHref(b.id)}
                        className={cx(
                          styles.tap,
                          "text-body-sm text-primary mt-stack md:justify-end",
                        )}
                        data-cursor="link"
                        data-cursor-label={brineLabel(b.id)}
                      >
                        <span className={cx(styles.drawLink)}>
                          Buy {brineLabel(b.id)}
                        </span>
                        {/* The drawn underline only exists on a fine pointer,
                            where it is a hover state. The arrow is the
                            affordance everything else reads: it is there at
                            rest, on touch, and under reduced motion. */}
                        <span aria-hidden="true" className="ml-2">
                          &rarr;
                        </span>
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}

              {/* The set is a product in its own right, so it takes a row of
                  the same shape rather than a promotional block. */}
              <article className={cx(styles.row)} data-reveal>
                <div className="gap-inline flex items-center">
                  <span
                    className={cx(
                      styles.figure,
                      "text-mono text-muted uppercase",
                    )}
                  >
                    Set
                  </span>
                </div>

                <div>
                  <h3 className="text-heading-3 text-primary">
                    {FULL_SET.name}
                  </h3>
                  <p className="text-body-sm text-muted mt-1">
                    {FULL_SET.descriptor}
                  </p>
                  <p className="text-body text-primary mt-stack max-w-prose">
                    {FULL_SET.line}
                  </p>
                </div>

                <div className="hidden xl:block" />

                <div className="md:text-right">
                  <p
                    className={cx(styles.figure, "text-heading-3 text-primary")}
                  >
                    {price(FULL_SET.priceNzd)}
                  </p>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ serves */}
        <section
          id="serves"
          aria-labelledby="serves-heading"
          data-reveal-group
          className="py-section"
        >
          <div className="max-w-page px-gutter mx-auto">
            <header className="max-w-prose" data-reveal>
              <p className="text-eyebrow text-muted font-mono uppercase">
                What it&rsquo;s for
              </p>
              <h2
                id="serves-heading"
                className="text-display-3 text-primary mt-stack"
              >
                Four ways in.
              </h2>
            </header>
          </div>

          {/* The rail bleeds to the gutter on touch and becomes a grid at
              768. Padding lives on the rail itself, not on this wrapper. */}
          <div className="max-w-page mt-block mx-auto md:px-[var(--spacing-gutter)]">
            {/* Below 768 the rail scrolls sideways and every card in it is
                plain text, so a keyboard could not move it at all. The list
                itself is the tab stop (axe `scrollable-region-focusable`,
                WCAG 2.1.1); above 768 it is a grid and scrolls nowhere. */}
            <ul tabIndex={0} className={cx(styles.rail)}>
              {SERVES.map((serve) => (
                <li key={serve.id}>
                  <article
                    className="bg-surface-raised border-hairline rounded-md border p-6"
                    data-reveal
                  >
                    <p className="text-eyebrow text-muted font-mono uppercase">
                      {serve.kicker}
                    </p>
                    <h3 className="text-heading-3 text-primary mt-2">
                      {serve.title}
                    </h3>
                    <p className="text-body text-primary mt-stack">
                      {serve.line}
                    </p>
                    <ul className="mt-block gap-inline flex flex-col">
                      {serve.build.map((step) => (
                        <li
                          key={step}
                          className={cx(
                            styles.figure,
                            "text-body-sm text-muted",
                          )}
                        >
                          {step}
                        </li>
                      ))}
                    </ul>
                    <p className="text-caption text-muted mt-block">
                      {brineLabel(serve.brine)}
                    </p>
                  </article>
                </li>
              ))}
            </ul>
          </div>

          {/* --------------------------------------------------- kitchen */}
          <div className="px-gutter mt-section">
            <div className="max-w-page mx-auto">
              <div
                className="bg-surface-inverse text-on-inverse rounded-lg px-6 py-[var(--spacing-block)] md:px-[var(--spacing-block)]"
                data-reveal
              >
                {/* The one parallax beat below the hero. The slab is the
                    ground and this column is the figure sitting on it, which
                    is the only shape of pair this page has outside the hero —
                    everything else here is running text, and running text that
                    drifts against its own heading reads as a fault rather than
                    as depth. The rate is a tenth of the parallax token: about
                    11px across a full viewport of scroll. */}
                <div className="max-w-prose" data-parallax="0.12">
                  <p className="text-eyebrow font-mono uppercase">
                    {KITCHEN.kicker}
                  </p>
                  {/* text-accent on surface-inverse is sanctioned for display
                      sizes only — hence the display step, not a heading one. */}
                  <h2 className="text-display-3 text-accent mt-stack">
                    {KITCHEN.title}
                  </h2>
                  <p className="text-body mt-block">{KITCHEN.line}</p>
                  <ul className="mt-block gap-inline flex flex-col">
                    {KITCHEN.spec.map((line) => (
                      <li
                        key={line}
                        className={cx(styles.figure, "text-body-sm")}
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ making */}
        <section
          id="making"
          aria-labelledby="making-heading"
          data-reveal-group
          className="px-gutter py-section"
        >
          <div className="max-w-page mx-auto">
            <header className="max-w-prose" data-reveal>
              <p className="text-eyebrow text-muted font-mono uppercase">
                How it&rsquo;s made
              </p>
              <h2
                id="making-heading"
                className="text-display-3 text-primary mt-stack"
              >
                Four steps.
              </h2>
            </header>

            <ol className="mt-block gap-block grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
              {PROCESS.map((step) => (
                <li key={step.index} data-reveal>
                  <p
                    className={cx(
                      styles.figure,
                      "text-mono text-muted uppercase",
                    )}
                  >
                    {step.index}
                  </p>
                  <h3 className="text-heading-3 text-primary border-hairline mt-stack border-t pt-4">
                    {step.name}
                  </h3>
                  <p className="text-body-sm text-muted mt-stack">
                    {step.detail}
                  </p>
                </li>
              ))}
            </ol>

            <dl
              className="mt-section gap-block border-hairline grid grid-cols-2 border-t pt-[var(--spacing-block)] xl:grid-cols-4"
              data-reveal
            >
              {/* The term is the label and the description is the figure, in
                  that DOM order; the column is reversed visually so the number
                  still leads. Rendering the label twice — once sr-only, once
                  visible — read it out twice to a screen reader. */}
              {SPEC_FIGURES.map((figure) => (
                <div key={figure.label} className="flex flex-col-reverse">
                  <dt className="text-caption text-muted mt-stack">
                    {figure.label}
                  </dt>
                  <dd
                    className={cx(styles.figure, "text-display-3 text-primary")}
                  >
                    {figure.value}
                    {figure.unit ? (
                      <span className="text-heading-3 text-muted">
                        {figure.unit}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
        <Buy signup={signup} />
      </main>

      <SiteFooter />
    </>
  );
}
