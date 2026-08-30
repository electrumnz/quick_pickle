import Link from "next/link";

import type { Cart } from "@/lib/commerce";

import { AvailabilityChip, Eyebrow } from "./bits";
import { BuyForm, BuyPanel } from "./BuyPanel";
import type { CheckoutKind } from "./cart";
import {
  formatPrice,
  inWords,
  perBottle,
  setSaving,
  type CatalogueEntry,
} from "./catalogue";
import { RECIPES_HREF } from "@/components/site/copy";

import { ADDED, PRODUCT, productPath, SHOP_PATH } from "./copy";
import { ProductMedia } from "./ProductMedia";
import { servesFor, serveCount, type Serve } from "./serves";
import styles from "./shop.module.css";
import { StickyBuy } from "./StickyBuy";
import { cx } from "./cx";
import { StoreFooter, StoreHeader } from "./StoreChrome";

/**
 * The product page.
 *
 * Read top to bottom it is an argument, in the order a person actually makes
 * the decision:
 *
 *   1. what it is        the bottle, the number, the descriptor, the job
 *   2. what it costs     price, per-100ml, availability, the buy control
 *   3. what it tastes of the notes, in the order they arrive
 *   4. what is in it     the ingredient run, printed the size it is on the label
 *   5. what to do with it the serves, with the builds, naming the drinks
 *   6. the cheaper way   the box, with the arithmetic shown
 *   7. the alternatives  the rest of the range
 *
 * The set is not a bottle and does not pretend to be one: steps 3 and 4 have no
 * meaning for a box, so it gets its contents instead. That branch is in
 * {@link ProductView} rather than hidden behind an `undefined` check further
 * down, because a page that renders empty sections is a page nobody finished.
 */

function Breadcrumb({ entry }: { entry: CatalogueEntry }) {
  return (
    <nav aria-label="Breadcrumb" className="px-gutter pt-stack">
      <ol className="max-w-page text-caption text-muted mx-auto flex flex-wrap items-center gap-2">
        <li>
          <Link href={SHOP_PATH} className={cx(styles.tap, "pr-1")}>
            <span className={cx(styles.drawLink)}>{PRODUCT.backToShop}</span>
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li aria-current="page" className={cx(styles.figure, "uppercase")}>
          {entry.title}
        </li>
      </ol>
    </nav>
  );
}

function Identity({ entry }: { entry: CatalogueEntry }) {
  const number = entry.brine?.number ?? null;
  return (
    <header>
      <div className="gap-stack flex flex-wrap items-baseline">
        {number === null ? null : (
          <p className={cx(styles.figure, "text-heading-2 text-muted")}>
            No. {number}
          </p>
        )}
        <Eyebrow className="text-muted">{entry.job}</Eyebrow>
      </div>

      <h1 className="text-display-2 text-primary mt-2">
        {entry.brine?.name ?? entry.title}
      </h1>

      {entry.descriptor === null ? null : (
        <p className="text-lede text-muted mt-2">{entry.descriptor}</p>
      )}

      {entry.line === null ? null : (
        <p className="text-lede text-primary mt-stack max-w-prose">
          {entry.line}
        </p>
      )}
    </header>
  );
}

/** Tasting notes as a numbered sequence, because they arrive in an order. */
function Notes({ notes }: { notes: readonly string[] }) {
  return (
    <section
      className="px-gutter py-section"
      aria-labelledby="notes-h2"
      id="notes"
    >
      <div className="max-w-page mx-auto">
        <Eyebrow className="text-muted">{PRODUCT.notesEyebrow}</Eyebrow>
        <h2 id="notes-h2" className="text-display-3 text-primary mt-stack">
          {PRODUCT.notesHeading}
        </h2>

        <ol className={cx(styles.seq, "mt-block max-w-4xl")}>
          {notes.map((note, index) => (
            <li key={note} className={cx(styles.seqItem)}>
              <span className={cx(styles.figure, "text-caption text-muted")}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="text-heading-2 text-primary">{note}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** The ingredient run, set the way it is set on the label. */
function Run({ run }: { run: readonly string[] }) {
  return (
    <section
      className={cx(styles.deep, "px-gutter py-section")}
      aria-labelledby="run-h2"
      id="run"
    >
      <div className="max-w-page mx-auto">
        <Eyebrow>{PRODUCT.runEyebrow}</Eyebrow>
        <h2 id="run-h2" className="text-display-3 mt-stack">
          {PRODUCT.runHeading}
        </h2>

        <ul className={cx(styles.run, "mt-block text-display-3")}>
          {run.map((item) => (
            <li key={item} className={cx(styles.runItem)}>
              {item}
            </li>
          ))}
        </ul>

        <p className="text-body-sm mt-block">{PRODUCT.runNote}</p>
      </div>
    </section>
  );
}

function ServeCard({ serve }: { serve: Serve }) {
  return (
    <article className="border-hairline bg-surface-raised flex h-full flex-col border p-5">
      <p className="text-eyebrow text-muted font-mono uppercase">
        {serve.kicker}
      </p>
      <h3 className="text-heading-2 text-primary mt-2">{serve.title}</h3>
      <p className="text-body-sm text-muted mt-stack">{serve.summary}</p>

      {serve.build.length === 0 ? null : (
        <>
          <p className="text-eyebrow text-muted mt-block font-mono uppercase">
            {PRODUCT.buildLabel}
          </p>
          <ul className="mt-2">
            {serve.build.map((line) => (
              <li
                key={line}
                className={cx(
                  styles.figure,
                  "border-hairline text-caption text-primary border-t py-1.5",
                )}
              >
                {line}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className={cx(styles.figure, "text-caption text-muted mt-auto pt-4")}>
        {serve.yieldText}
      </p>
    </article>
  );
}

function Serves({ entry }: { entry: CatalogueEntry }) {
  if (entry.brine === null) return null;
  const { drinks, dishes } = servesFor(entry.brine.id);
  const total = serveCount(entry.brine.id);
  if (drinks.length === 0 && dishes.length === 0) return null;

  return (
    <section
      className="px-gutter py-section"
      aria-labelledby="serves-h2"
      id="serves"
    >
      <div className="max-w-page mx-auto">
        <Eyebrow className="text-muted">{PRODUCT.servesEyebrow}</Eyebrow>
        <h2 id="serves-h2" className="text-display-3 text-primary mt-stack">
          {drinks.length > 0
            ? PRODUCT.servesHeading
            : PRODUCT.servesHeadingDish}
        </h2>
        {/* The count was a number with nowhere to go until /recipes shipped —
            a promise the page broke in the same sentence it made it. It is a
            link now, and the number is counted from the same index the library
            renders, so the two cannot disagree. */}
        <p className={cx(styles.figure, "text-caption text-muted mt-stack")}>
          {total} {PRODUCT.libraryCount}
          {" — "}
          <Link href={RECIPES_HREF} className={cx(styles.tap, "text-primary")}>
            <span className={cx(styles.drawLink)}>{ADDED.libraryLink}</span>
          </Link>
        </p>
      </div>

      {drinks.length === 0 ? null : (
        <>
          <div className="max-w-page px-gutter mt-block mx-auto md:px-0">
            <h3 className="text-eyebrow text-muted border-hairline border-b pb-3 font-mono uppercase">
              {PRODUCT.drinksLabel}
            </h3>
          </div>
          <div className="max-w-page mt-stack mx-auto md:px-[var(--spacing-gutter)]">
            {/* The rail scrolls sideways below 768 and every card in it is
                plain text, so there was nothing for a keyboard to focus and
                no way to reach the cards past the first (axe
                `scrollable-region-focusable`, WCAG 2.1.1). The list is the tab
                stop; above 768 it is a grid and scrolls nowhere. */}
            <ul tabIndex={0} className={cx(styles.rail)}>
              {drinks.map((serve) => (
                <li key={serve.slug}>
                  <ServeCard serve={serve} />
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {dishes.length === 0 ? null : (
        <>
          <div className="max-w-page px-gutter mt-section mx-auto md:px-0">
            <h3 className="text-eyebrow text-muted border-hairline border-b pb-3 font-mono uppercase">
              {PRODUCT.dishesLabel}
            </h3>
          </div>
          <div className="max-w-page mt-stack mx-auto md:px-[var(--spacing-gutter)]">
            <ul tabIndex={0} className={cx(styles.rail)}>
              {dishes.map((serve) => (
                <li key={serve.slug}>
                  <ServeCard serve={serve} />
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The bundle path.
 *
 * Shown with the arithmetic rather than a badge: the box price, the per-bottle
 * price and what the same bottles cost one at a time, all computed from the
 * live catalogue. If the maths does not come out in the buyer's favour the
 * block simply does not appear, which is the only honest way to write it.
 */
function Bundle({
  set,
  siblings,
}: {
  set: CatalogueEntry;
  siblings: readonly CatalogueEntry[];
}) {
  const each = perBottle(set);
  const saving = setSaving(set, siblings);

  return (
    // Ruled rather than tinted. The block carries an availability chip, and
    // `text-danger` has no sanctioned pairing on surface-sunken — so the band
    // stays on the page ground, where every colour it uses is one the brand
    // checked, and the separation is done with two hairlines instead.
    <section
      className="border-hairline px-gutter py-section border-y"
      aria-labelledby="bundle-h2"
    >
      <div className="max-w-page mx-auto">
        <Eyebrow className="text-muted">{PRODUCT.bundleEyebrow}</Eyebrow>
        <div className="gap-block mt-stack flex flex-wrap items-end justify-between">
          <div>
            <h2 id="bundle-h2" className="text-display-3 text-primary">
              {set.title}
            </h2>
            {set.line === null ? null : (
              <p className="text-body text-muted mt-stack max-w-prose">
                {set.line}
              </p>
            )}
            {saving === null ? null : (
              <p className="text-body text-primary mt-stack">
                {formatPrice(set.price)} for {inWords(set.bottleCount)}
                {each === null
                  ? null
                  : ` — ${formatPrice(each)} a bottle`}.{" "}
                {formatPrice(saving.saving)} less than{" "}
                {formatPrice(saving.separately)} bought one at a time.
              </p>
            )}
          </div>

          <div className="gap-stack flex min-w-[16rem] flex-col">
            <AvailabilityChip entry={set} className="self-start" />
            <BuyForm entry={set} returnTo={productPath(set.handle)} compact />
            <Link
              href={productPath(set.handle)}
              className={cx(styles.tap, "text-body-sm text-primary")}
            >
              <span className={cx(styles.drawLink)}>{PRODUCT.boxLink}</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/** What the box holds, for the set's own page. */
function BoxContents({ contents }: { contents: readonly CatalogueEntry[] }) {
  return (
    <section
      className="px-gutter py-section"
      aria-labelledby="contents-h2"
      id="contents"
    >
      <div className="max-w-page mx-auto">
        <Eyebrow className="text-muted">{PRODUCT.boxEyebrow}</Eyebrow>
        <h2 id="contents-h2" className="text-display-3 text-primary mt-stack">
          {PRODUCT.boxHeading}
        </h2>

        {/* Why the fourth bottle is missing, before the list makes a buyer
            wonder. The supply constraint is real and is stated in these words
            elsewhere in the range; this is the same fact, not a new claim. */}
        <p className="text-body text-muted mt-stack max-w-prose">
          {PRODUCT.boxNote}
        </p>

        <ul className="mt-block">
          {contents.map((entry) => (
            <li key={entry.handle}>
              <Link
                href={productPath(entry.handle)}
                className={cx(styles.chooserRow, styles.tap, "text-primary")}
              >
                <span>
                  <span className="text-heading-3 block">{entry.job}</span>
                  <span
                    className={cx(
                      styles.figure,
                      "text-caption text-muted uppercase",
                    )}
                  >
                    {entry.title}
                    {entry.descriptor === null
                      ? null
                      : ` · ${entry.descriptor}`}
                  </span>
                </span>
                <span className={cx(styles.figure, "text-body-sm")}>
                  {formatPrice(entry.price)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function AlsoInRange({ others }: { others: readonly CatalogueEntry[] }) {
  if (others.length === 0) return null;
  return (
    <section className="px-gutter py-section" aria-labelledby="also-h2">
      <div className="max-w-page mx-auto">
        <Eyebrow className="text-muted">{PRODUCT.alsoEyebrow}</Eyebrow>
        <h2 id="also-h2" className="text-display-3 text-primary mt-stack">
          {PRODUCT.alsoHeading}
        </h2>

        <ul className="mt-block">
          {others.map((entry) => (
            <li key={entry.handle}>
              <Link
                href={productPath(entry.handle)}
                className={cx(styles.chooserRow, styles.tap, "text-primary")}
              >
                <span>
                  <span className="text-heading-3 block">{entry.job}</span>
                  <span
                    className={cx(
                      styles.figure,
                      "text-caption text-muted uppercase",
                    )}
                  >
                    {entry.title}
                  </span>
                </span>
                <span className="gap-stack flex items-center">
                  <AvailabilityChip entry={entry} />
                  <span className={cx(styles.figure, "text-body-sm")}>
                    {formatPrice(entry.price)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function ProductView({
  entry,
  siblings,
  set,
  degraded,
  cart,
  added,
  problem,
  checkout,
}: {
  entry: CatalogueEntry;
  /** The other bottles in the range, in range order. */
  siblings: readonly CatalogueEntry[];
  /** The box, when there is one and this is not it. */
  set: CatalogueEntry | null;
  degraded: boolean;
  cart: Cart | null;
  added: number | null;
  problem: string | null;
  checkout: CheckoutKind;
}) {
  const isSet = entry.kind === "set";
  const plate = isSet ? "set" : (entry.brine?.id ?? "plain");
  const others = siblings.filter((other) => other.handle !== entry.handle);
  // What the box holds, in range order, as many as the pack says.
  const boxContents = others
    .filter((other) => other.kind === "brine")
    .slice(0, entry.bottleCount);
  const boxHandles = new Set(boxContents.map((other) => other.handle));

  return (
    <>
      <StoreHeader here="product" />

      <main id="top" className="flex-1">
        <Breadcrumb entry={entry} />

        <div className="px-gutter pt-stack pb-block">
          <div className="max-w-page gap-block mx-auto grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <ProductMedia
              variant={plate}
              label={`${entry.title}${entry.descriptor === null ? "" : ` — ${entry.descriptor}`}`}
              className={cx(styles.stickyColumn)}
            />

            <div id="buy" className="gap-block flex flex-col">
              <Identity entry={entry} />
              <BuyPanel
                entry={entry}
                returnTo={productPath(entry.handle)}
                degraded={degraded}
                cart={cart}
                added={added}
                problem={problem}
                checkout={checkout}
              />
            </div>
          </div>
        </div>

        {isSet ? (
          <BoxContents contents={boxContents} />
        ) : (
          <>
            {entry.brine === null ? null : <Notes notes={entry.brine.notes} />}
            {entry.brine === null ? null : <Run run={entry.brine.run} />}
            <Serves entry={entry} />
            {set === null || degraded ? null : (
              <Bundle
                set={set}
                siblings={siblings.filter((s) => s.kind === "brine")}
              />
            )}
          </>
        )}

        {/* The box has just had a band of its own; listing it again two
            sections later is repetition, not navigation. */}
        <AlsoInRange
          others={others.filter((other) =>
            isSet
              ? // On the box's own page the contents are listed directly above;
                // repeating them here would be the same list twice.
                !boxHandles.has(other.handle)
              : // On a bottle's page the box has just had a band of its own.
                set === null || degraded || other.kind !== "set",
          )}
        />
      </main>

      <StoreFooter />

      {/* The same form as the panel above, in the bar that appears once the
          panel has scrolled away. Never rendered without script, never
          rendered above 1024. */}
      {degraded || added !== null ? null : (
        <StickyBuy watch="buy" label={PRODUCT.stickyBuyLabel}>
          <div className="min-w-0 flex-1">
            <p className="text-caption text-muted truncate">{entry.title}</p>
            <p className={cx(styles.figure, "text-body text-primary")}>
              {formatPrice(entry.price)}
            </p>
          </div>
          <BuyForm entry={entry} returnTo={productPath(entry.handle)} compact />
        </StickyBuy>
      )}
    </>
  );
}
