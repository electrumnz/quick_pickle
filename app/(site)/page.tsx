import Image from "next/image";
import Link from "next/link";

import { Hero } from "@/components/home/Hero";
import { MotionRoot } from "@/components/home/MotionRoot";
import {
  ALL_BRINES,
  BUY,
  brineLabel,
  FULL_SET,
  fullSetHref,
  HOME,
  KITCHEN,
  PROCESS,
  price,
  productHref,
  SERVES,
  SPEC_FIGURES,
  SHOP_HREF,
} from "@/components/home/data";
import { cx } from "@/components/home/cx";
import styles from "@/components/home/home.module.css";
import { CHOOSER, JOB, productPath } from "@/components/product/copy";
import { BOTTLE_SHOTS } from "@/components/product/media";
import { StoreFooter, StoreHeader } from "@/components/product/StoreChrome";
import { LIST } from "@/components/site/copy";
import { JoinTheList, signupParams } from "@/components/site/SignupForm";

/**
 * HALF SOUR — the homepage.
 *
 * A rendering of `components/home/data.ts` and `content/brines.ts` and nothing
 * else: no page in this build carries copy of its own, so the copy auditor
 * scans the data layer once and the founder edits it in one place.
 *
 * It used to be a one-page site — its own masthead of section anchors, its
 * own footer, a Buy button that scrolled to a "buy" block at the bottom, and
 * a range list that repeated the shop. It is now the front door of a
 * multi-page store and shares the store's header and footer: the hero says
 * what the product is, the chooser and the serves say what to do with it, the
 * four tiles go to the four bottles, and the making section is the proof.
 *
 * ## Why this page reads `searchParams`
 *
 * The list sign-up at the foot is a plain `<form>` posting to a Server Action,
 * and the action answers by redirecting back here with the outcome in the
 * query string. That is what makes the form work with JavaScript switched
 * off. The cost is that this route renders per request; it reads nothing from
 * the network on the way, so it costs a render and buys a confirmation the
 * visitor can actually see.
 */

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

/**
 * A section opener. The eyebrow is optional and mostly absent: an eyebrow
 * above every heading is furniture, and the headings here say what the
 * section is. It stays where the heading needs a lead-in to make sense.
 */
function SectionHead({
  id,
  eyebrow,
  heading,
}: {
  id: string;
  eyebrow?: string;
  heading: string;
}) {
  return (
    <header className="max-w-prose" data-reveal>
      {eyebrow === undefined ? null : (
        <p className="text-eyebrow text-muted font-mono uppercase">{eyebrow}</p>
      )}
      <h2
        id={id}
        className={cx(
          "text-display-3 text-primary",
          eyebrow === undefined ? undefined : "mt-stack",
        )}
      >
        {heading}
      </h2>
    </header>
  );
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
      <StoreHeader here="home" />

      <main id="top" className="flex-1">
        <Hero />

        {/* ----------------------------------------------------- chooser */}
        <section
          id="chooser"
          aria-labelledby="chooser-heading"
          data-reveal-group
          className="px-gutter py-section"
        >
          <div className="max-w-page mx-auto">
            <SectionHead
              id="chooser-heading"
              eyebrow={HOME.chooser.eyebrow}
              heading={HOME.chooser.heading}
            />
            <ul className="mt-block max-w-4xl" data-reveal>
              {CHOOSER.map((row) => (
                <li key={`${row.making}-${row.handle}`}>
                  <Link
                    href={productPath(row.handle)}
                    className={cx(
                      styles.chooserRow,
                      styles.tap,
                      "text-primary",
                    )}
                  >
                    <span className="text-body md:text-lede">{row.making}</span>
                    <span
                      className={cx(
                        styles.figure,
                        "text-caption text-muted uppercase whitespace-nowrap",
                      )}
                    >
                      {row.handle === FULL_SET.handle
                        ? FULL_SET.name
                        : (ALL_BRINES.find((b) => b.handle === row.handle)
                            ?.name ?? row.handle)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ------------------------------------------------------ serves */}
        <section
          id="serves"
          aria-labelledby="serves-heading"
          data-reveal-group
          className="pb-section"
        >
          <div className="max-w-page px-gutter mx-auto">
            <SectionHead id="serves-heading" heading={HOME.serves.heading} />
          </div>

          {/* The rail bleeds to the gutter on touch and becomes a grid at
              768. Padding lives on the rail itself, not on this wrapper. */}
          <div className="max-w-page mt-block mx-auto md:px-[var(--spacing-gutter)]">
            {/* Below 768 the rail scrolls sideways and every card in it is
                plain text, so the list itself is the tab stop (axe
                `scrollable-region-focusable`, WCAG 2.1.1). */}
            <ul tabIndex={0} className={cx(styles.rail)}>
              {SERVES.map((serve) => (
                <li key={serve.id}>
                  <article
                    className="bg-surface-raised border-hairline flex h-full flex-col rounded-md border p-6"
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
                            "text-body-sm text-primary",
                          )}
                        >
                          {step}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-auto pt-6">
                      <Link
                        href={productHref(serve.brine)}
                        className={cx(styles.tap, "text-body-sm text-primary")}
                      >
                        <span className={cx(styles.drawLink)}>
                          {brineLabel(serve.brine)}
                        </span>
                        <span aria-hidden="true" className="ml-2">
                          &rarr;
                        </span>
                      </Link>
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
                <div className="max-w-prose" data-parallax="0.12">
                  <p className="text-eyebrow font-mono uppercase">
                    {KITCHEN.kicker}
                  </p>
                  {/* text-accent on surface-inverse is sanctioned for display
                      sizes only — hence the display step. */}
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

        {/* ------------------------------------------------------- range */}
        <section
          id="range"
          aria-labelledby="range-heading"
          data-reveal-group
          className="px-gutter pb-section"
        >
          <div className="max-w-page mx-auto">
            <div className="gap-stack flex flex-wrap items-end justify-between">
              <SectionHead id="range-heading" heading={HOME.range.heading} />
              <Link
                href={SHOP_HREF}
                className={cx(styles.tap, "text-body-sm text-primary")}
                data-reveal
              >
                <span className={cx(styles.drawLink)}>{HOME.range.all}</span>
                <span aria-hidden="true" className="ml-2">
                  &rarr;
                </span>
              </Link>
            </div>

            <ul className={cx(styles.tiles, "mt-block")}>
              {ALL_BRINES.map((b) => {
                const shot = BOTTLE_SHOTS[b.id];
                return (
                  <li key={b.id} className={cx(styles.tile)} data-reveal>
                    <div className={cx(styles.tileMedia)}>
                      {/* Lazy and low priority, and both said out loud: the
                          tiles sit two screens down, but a headless Chrome
                          on a fast link starts them inside the hero's first
                          paint, and Lighthouse's model then charges all four
                          against the largest paint. Low priority keeps them
                          behind the plate in the queue. */}
                      <Image
                        src={shot.still}
                        alt=""
                        fill
                        loading="lazy"
                        fetchPriority="low"
                        sizes="(max-width: 64rem) 46vw, 24vw"
                        className={cx(styles.tileArt)}
                      />
                    </div>
                    <p className="text-eyebrow text-muted font-mono uppercase">
                      {JOB[b.id]}
                    </p>
                    <h3 className="text-heading-3 text-primary">
                      <Link
                        href={productHref(b.id)}
                        className={cx(styles.tileLink)}
                      >
                        {brineLabel(b.id)}
                      </Link>
                    </h3>
                    <p className="text-body-sm text-muted">{b.descriptor}</p>
                    <p
                      className={cx(
                        styles.figure,
                        "text-body-sm text-primary mt-auto",
                      )}
                    >
                      {price(b.priceNzd)}
                      {b.supplyLimited ? (
                        <span className="text-muted">
                          {" "}
                          &middot; Limited by leaf supply
                        </span>
                      ) : null}
                    </p>
                  </li>
                );
              })}
            </ul>

            <p
              className="text-body-sm text-muted border-hairline mt-block border-t pt-4"
              data-reveal
            >
              <Link
                href={fullSetHref()}
                className={cx(styles.tap, "text-primary")}
              >
                <span className={cx(styles.drawLink)}>{FULL_SET.name}</span>
              </Link>
              , {FULL_SET.descriptor.toLowerCase()},{" "}
              <span className={cx(styles.figure)}>
                {price(FULL_SET.priceNzd)}
              </span>
              . {FULL_SET.line}
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------ making */}
        <section
          id="making"
          aria-labelledby="making-heading"
          data-reveal-group
          className="px-gutter pb-section"
        >
          <div className="max-w-page mx-auto">
            <SectionHead
              id="making-heading"
              eyebrow={HOME.making.eyebrow}
              heading={HOME.making.heading}
            />

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
                  <p className="text-body-sm text-primary mt-stack">
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
                  still leads. */}
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

        {/* ------------------------------------------------ list and trade */}
        <section
          id="list"
          aria-labelledby="list-heading"
          data-reveal-group
          className="bg-surface-sunken border-strong px-gutter py-section border-t"
        >
          <div className="max-w-page gap-block mx-auto grid md:grid-cols-2">
            <div className="max-w-prose" data-reveal>
              <h2 id="list-heading" className="text-display-3 text-primary">
                {LIST.heading}
              </h2>
              <p className="text-body text-primary mt-stack max-w-prose">
                {LIST.line}
              </p>
              <div className="mt-block">
                <JoinTheList state={signup} sourcePath="/" />
              </div>
            </div>

            <div className="max-w-prose" data-reveal>
              <h3 className="text-heading-2 text-primary">
                {BUY.trade.heading}
              </h3>
              <p className="text-body text-primary mt-stack">
                {BUY.trade.line}
              </p>
              <Link
                href={BUY.trade.href}
                className={cx(
                  styles.button,
                  styles.buttonSecondary,
                  "mt-block w-fit",
                )}
              >
                {BUY.trade.label}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <StoreFooter />
    </>
  );
}
