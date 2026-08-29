import Link from "next/link";

import type { Cart } from "@/lib/commerce";

import { AddedStrip, BuyForm } from "./BuyPanel";
import { BottlePlate } from "./BottlePlate";
import {
  formatPrice,
  inWords,
  perBottle,
  setSaving,
  type Catalogue,
  type CatalogueEntry,
} from "./catalogue";
import {
  CHOOSER,
  PRODUCT,
  PROBLEM,
  productPath,
  SHOP,
  SHOP_PATH,
  STATE,
} from "./copy";
import { ProductCard } from "./ProductCard";
import styles from "./shop.module.css";
import { cx } from "./cx";
import { StoreFooter, StoreHeader } from "./StoreChrome";

/**
 * The collection page.
 *
 * Ordered for a decision rather than for a brand film. The four bottles are the
 * first thing under the masthead, each one led by the job it does; the box is
 * next, with the per-bottle arithmetic shown rather than asserted; and the
 * chooser — "if you are making X, reach for Y" — is last, for the shopper the
 * first two did not settle.
 *
 * With five products a filter bar would be a puzzle, so there is not one. The
 * jobs on the cards and the eleven rows of the chooser between them cover every
 * question a filter would have answered, and both work with scripting off.
 */

function Masthead({ count }: { count: number }) {
  return (
    <section className="px-gutter pt-block pb-block" aria-labelledby="shop-h1">
      <div className="max-w-page mx-auto">
        <p className="text-eyebrow text-muted font-mono uppercase">
          {SHOP.eyebrow}
        </p>
        <h1 id="shop-h1" className="text-display-2 text-primary mt-stack">
          {SHOP.heading}
        </h1>
        <p className="text-lede text-muted mt-stack max-w-prose">{SHOP.lede}</p>
        <p
          className={cx(
            styles.figure,
            "text-caption text-muted mt-block border-hairline border-t pt-3 uppercase",
          )}
        >
          {count} {SHOP.productsWord} · {SHOP.rangeNote}
        </p>
      </div>
    </section>
  );
}

/**
 * The box, given a band of its own.
 *
 * The saving is COMPUTED from the live catalogue price of the three bottles it
 * contains, on every render. A saving that is written into copy is a saving
 * that becomes untrue the first time a price moves, and under the Fair Trading
 * Act an untrue one is a misrepresentation rather than a typo.
 */
function SetBand({
  set,
  bottles,
  degraded,
}: {
  set: CatalogueEntry;
  bottles: readonly CatalogueEntry[];
  degraded: boolean;
}) {
  const each = perBottle(set);
  const saving = degraded ? null : setSaving(set, bottles);

  return (
    <section
      className={cx(styles.deep, "px-gutter py-section")}
      aria-labelledby="set-h2"
    >
      <div className="max-w-page mx-auto">
        <p className="text-eyebrow font-mono uppercase">{SHOP.setHeading}</p>

        <div className="gap-block mt-block grid items-center md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div
            className={cx(styles.plate)}
            style={{ aspectRatio: "5 / 4", borderRadius: "var(--radius-sm)" }}
          >
            <BottlePlate variant="set" label="" className={styles.plateArt} />
          </div>

          <div>
            <h2 id="set-h2" className="text-display-3">
              {set.title}
            </h2>
            {set.line === null ? null : (
              <p className="text-lede mt-stack max-w-prose">{set.line}</p>
            )}

            <dl className="gap-block mt-block flex flex-wrap">
              <div>
                <dt className="text-eyebrow font-mono uppercase">The box</dt>
                <dd className={cx(styles.figure, "text-display-3 mt-1")}>
                  {formatPrice(set.price)}
                </dd>
              </div>
              {each === null ? null : (
                <div>
                  <dt className="text-eyebrow font-mono uppercase">A bottle</dt>
                  <dd className={cx(styles.figure, "text-display-3 mt-1")}>
                    {formatPrice(each)}
                  </dd>
                </div>
              )}
              {saving === null ? null : (
                <div>
                  <dt className="text-eyebrow font-mono uppercase">
                    Separately
                  </dt>
                  <dd className={cx(styles.figure, "text-display-3 mt-1")}>
                    {formatPrice(saving.separately)}
                  </dd>
                </div>
              )}
            </dl>

            {saving === null ? null : (
              <p className="text-body mt-stack">
                {formatPrice(saving.saving)} less than buying the{" "}
                {inWords(set.bottleCount)} one at a time.
              </p>
            )}

            <div className="gap-stack mt-block flex flex-wrap items-center">
              <div className="min-w-[14rem]">
                {degraded ? null : (
                  <BuyForm
                    entry={set}
                    returnTo={`${SHOP_PATH}#added`}
                    compact
                  />
                )}
              </div>
              <Link
                href={productPath(set.handle)}
                className={cx(styles.tap, "text-body-sm")}
              >
                <span className={cx(styles.drawLink)}>{PRODUCT.boxLink}</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Chooser({ entries }: { entries: readonly CatalogueEntry[] }) {
  const titleFor = (handle: string) =>
    entries.find((entry) => entry.handle === handle)?.title ?? handle;

  return (
    <section
      // A drawn rule, not just a change of ground. In dark, `surface-deep` and
      // `surface-sunken` both resolve to Shelf, so the band above and this one
      // would run into each other as one field; the rule is what keeps the two
      // sections separate in both schemes.
      className="border-strong bg-surface-sunken px-gutter py-section border-t"
      aria-labelledby="chooser-h2"
    >
      <div className="max-w-page mx-auto">
        {/* Vinegar ground. `text-muted` is NOT a sanctioned pairing on
            surface-sunken (lib/brand/semantics.ts SEMANTIC_PAIRS), so hierarchy
            here is carried by size and letterform rather than by fading the
            contrast to a value the brand never checked. */}
        <p className="text-eyebrow text-primary font-mono uppercase">
          {SHOP.chooserEyebrow}
        </p>
        <h2 id="chooser-h2" className="text-display-3 text-primary mt-stack">
          {SHOP.chooserHeading}
        </h2>

        <ul className="mt-block max-w-4xl">
          {CHOOSER.map((row) => (
            <li key={`${row.making}-${row.handle}`}>
              <Link
                href={productPath(row.handle)}
                className={cx(styles.chooserRow, styles.tap, "text-primary")}
              >
                <span className="text-body md:text-lede">{row.making}</span>
                <span
                  className={cx(
                    styles.figure,
                    "text-caption uppercase whitespace-nowrap",
                  )}
                >
                  {titleFor(row.handle)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function ShopView({
  catalogue,
  cart,
  added,
  problem,
  checkoutLive,
}: {
  catalogue: Catalogue;
  cart: Cart | null;
  added: { readonly handle: string; readonly quantity: number } | null;
  problem: string | null;
  checkoutLive: boolean;
}) {
  const bottles = catalogue.entries.filter((entry) => entry.kind !== "set");
  const set = catalogue.entries.find((entry) => entry.kind === "set") ?? null;

  return (
    <>
      <StoreHeader here="shop" />

      <main id="top" className="flex-1">
        <Masthead count={catalogue.entries.length} />

        {catalogue.degraded ? (
          <div className="px-gutter">
            <div className="max-w-page border-hairline bg-surface-sunken mx-auto border p-4">
              <p className="text-body text-primary font-semibold">
                {STATE.degradedHeading}
              </p>
              <p className="text-body-sm text-primary mt-2 max-w-prose">
                {STATE.degradedNote}
              </p>
            </div>
          </div>
        ) : null}

        {problem === null ? null : (
          <div className="px-gutter">
            <p
              className="max-w-page border-danger text-danger text-body-sm mx-auto border-l-2 pl-3"
              role="alert"
            >
              {PROBLEM[problem] ?? PROBLEM.failed}
            </p>
          </div>
        )}

        {added === null ? null : (
          <div className="px-gutter scroll-mt-24" id="added">
            <div className="max-w-page mx-auto">
              <div className="md:max-w-md">
                <AddedStrip
                  cart={cart}
                  handle={added.handle}
                  quantity={added.quantity}
                  checkoutLive={checkoutLive}
                />
              </div>
            </div>
          </div>
        )}

        <section
          id="bottles"
          className="px-gutter pt-block pb-section"
          aria-labelledby="bottles-h2"
        >
          <div className="max-w-page mx-auto">
            <h2
              id="bottles-h2"
              className="text-eyebrow text-muted border-hairline border-b pb-3 font-mono uppercase"
            >
              {SHOP.bottlesHeading}
            </h2>

            {bottles.length === 0 ? (
              <div className="py-block">
                <p className="text-heading-2 text-primary">
                  {STATE.emptyHeading}
                </p>
                <p className="text-body text-muted mt-stack">
                  {STATE.emptyNote}
                </p>
              </div>
            ) : (
              <div className={cx(styles.grid, "mt-block")}>
                {bottles.map((entry) => (
                  <ProductCard
                    key={entry.handle}
                    entry={entry}
                    degraded={catalogue.degraded}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {set === null ? null : (
          <SetBand set={set} bottles={bottles} degraded={catalogue.degraded} />
        )}

        <Chooser entries={catalogue.entries} />
      </main>

      <StoreFooter />
    </>
  );
}
