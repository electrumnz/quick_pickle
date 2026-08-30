import { brineLabel } from "@/content/brines";
import { formatMoney } from "@/lib/commerce";
import { cx } from "@/components/product/cx";
import { formatPrice } from "@/components/product/catalogue";
import shop from "@/components/product/shop.module.css";
import { StoreFooter, StoreHeader } from "@/components/product/StoreChrome";

import { fill, SAMPLES_ANCHOR, WHOLESALE } from "./copy";
import { AskForSamples, type SignupState } from "./SignupForm";
import styles from "./site.module.css";
import {
  CASE_BOTTLES,
  gstPercent,
  tradeDiscountPercent,
  TRADE_LIST,
} from "./trade";

/**
 * The trade page.
 *
 * Five of the seventeen avatar-audit checks were red for one missing route, and
 * all five were the same failure: a bar manager who looked this company up
 * landed on a storefront with no page for a venue. The homepage tells a
 * stranger the brine is good enough to put on a menu; this is the door that
 * claim did not have.
 *
 * ## The contradiction this page settles
 *
 * The BrandScript's B2B agreement promises "trade pricing is one published
 * number, the same for every venue of your size. You will not find out later
 * that someone got a better one." The storefront's answer was an email address
 * and a promise of pricing inside two working days. A price sent privately on
 * request is not a published price, whatever the number turns out to be — so
 * the number is here, with the arithmetic that produced it printed beside it.
 *
 * Nothing on this page is typed in. Every figure comes out of `trade.ts`, which
 * derives it from `content/brines.ts` in integer minor units. A trade sheet that
 * disagrees with the invoice by a cent is worse than no trade sheet.
 */

function Sheet() {
  return (
    <>
      {/* The note sits ABOVE the scroll box rather than inside the table as a
          <caption>. A caption is as wide as the table, and this table is
          34rem wide inside a 375px scroller — so half the sentence was
          scrolled off the right edge of the phone. It is still the table's
          description, by aria-describedby. */}
      <p id="trade-note" className="text-caption text-muted max-w-prose">
        {WHOLESALE.listNote}
      </p>
      {/* `tabIndex` because the box scrolls and holds nothing focusable: with
          a keyboard alone there was no way to bring the trade and case columns
          into view on a phone (axe `scrollable-region-focusable`, WCAG 2.1.1).
          The build's one `:focus-visible` ring makes the stop visible. */}
      <div tabIndex={0} className={cx(styles.sheetScroll, "mt-stack")}>
        <table
          className={cx(styles.sheet)}
          aria-labelledby="w-list"
          aria-describedby="trade-note"
        >
          <thead>
            <tr>
              <th scope="col">{WHOLESALE.columnBottle}</th>
              <th scope="col">{WHOLESALE.columnShelf}</th>
              <th scope="col">{WHOLESALE.columnTrade}</th>
              <th scope="col">{WHOLESALE.columnCase}</th>
              <th scope="col">{WHOLESALE.columnPour}</th>
            </tr>
          </thead>
          <tbody>
            {TRADE_LIST.map((row) => (
              <tr key={row.brine.id}>
                <th scope="row">
                  {brineLabel(row.brine.id)}
                  <span className="text-body-sm text-muted mt-1 block font-normal">
                    {row.brine.descriptor}
                  </span>
                  {row.supplyLimited ? (
                    <span className="text-caption text-muted mt-2 block max-w-prose font-normal">
                      {WHOLESALE.supplyNote}
                    </span>
                  ) : null}
                </th>
                <td className={cx(styles.num, "text-body-sm text-muted")}>
                  {formatPrice(row.shelf)}
                </td>
                <td className={cx(styles.num, "text-heading-3 text-primary")}>
                  {formatMoney(row.bottle)}
                </td>
                <td className={cx(styles.num, "text-body text-primary")}>
                  {formatMoney(row.caseTotal)}
                </td>
                <td className="text-body text-primary">
                  {row.pours === null ? (
                    <span className="text-body-sm text-muted">
                      {WHOLESALE.noPour}
                    </span>
                  ) : (
                    <>
                      <span className={cx(styles.num)}>
                        {formatMoney(row.pours.perPour)}
                      </span>
                      <span className="text-caption text-muted mt-1 block">
                        {fill(WHOLESALE.pourNote, {
                          count: row.pours.count,
                          ml: row.pours.perServeMl,
                        })}
                      </span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function WholesaleView({ signup }: { signup: SignupState }) {
  return (
    <>
      {/* Awaited by the page: StoreHeader reads the cart through the provider. */}
      <StoreHeader here="wholesale" />

      <main id="top" className="flex-1">
        <section className="px-gutter pt-block pb-block" aria-labelledby="w-h1">
          <div className="max-w-page mx-auto">
            <p className="text-eyebrow text-muted font-mono uppercase">
              {WHOLESALE.eyebrow}
            </p>
            <h1 id="w-h1" className="text-display-2 text-primary mt-stack">
              {WHOLESALE.heading}
            </h1>
            <p className="text-lede text-muted mt-stack max-w-prose">
              {WHOLESALE.lede}
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------ the list */}
        <section
          className="px-gutter pb-section"
          aria-labelledby="w-list"
          id="prices"
        >
          <div className="max-w-page mx-auto">
            <p className="text-eyebrow text-muted font-mono uppercase">
              {WHOLESALE.listEyebrow}
            </p>
            <h2 id="w-list" className="text-display-3 text-primary mt-stack">
              {WHOLESALE.listHeading}
            </h2>
            <div className="mt-block">
              <Sheet />
            </div>
          </div>
        </section>

        {/* --------------------------------------------------- the working */}
        <section
          className={cx(shop.deep, "px-gutter py-section")}
          aria-labelledby="w-working"
        >
          <div className="max-w-page mx-auto">
            <p className="text-eyebrow font-mono uppercase">
              {WHOLESALE.workingEyebrow}
            </p>
            <h2 id="w-working" className="text-display-3 mt-stack">
              {WHOLESALE.workingHeading}
            </h2>
            <ol className="mt-block max-w-prose">
              {WHOLESALE.workingSteps.map((step, index) => (
                <li
                  key={step}
                  className="border-hairline gap-stack mt-stack grid grid-cols-[2rem_minmax(0,1fr)] border-t pt-4"
                >
                  <span className={cx(shop.figure, "text-caption")}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-body">
                    {fill(step, {
                      gst: gstPercent(),
                      discount: tradeDiscountPercent(),
                    })}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-body-sm mt-block max-w-prose">
              {WHOLESALE.workingNote}
            </p>
          </div>
        </section>

        {/* ----------------------------------------------------- the terms */}
        <section className="px-gutter py-section" aria-labelledby="w-terms">
          <div className="max-w-page mx-auto">
            <p className="text-eyebrow text-muted font-mono uppercase">
              {WHOLESALE.termsEyebrow}
            </p>
            <h2 id="w-terms" className="text-display-3 text-primary mt-stack">
              {WHOLESALE.termsHeading}
            </h2>

            <dl className="mt-block">
              {WHOLESALE.terms.map((term) => (
                <div
                  key={term.label}
                  className={cx(
                    styles.definitions,
                    "border-hairline mt-stack border-t pt-4",
                  )}
                >
                  <dt className="text-heading-3 text-primary">{term.label}</dt>
                  <dd className="text-body text-muted max-w-prose">
                    {term.body}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="text-body-sm text-muted mt-block max-w-prose">
              {WHOLESALE.pourLine}{" "}
              <span className={cx(shop.figure)}>
                {String(CASE_BOTTLES)} × 500 ml
              </span>
            </p>
          </div>
        </section>

        {/* --------------------------------------------------- the samples */}
        <section
          className="border-hairline px-gutter py-section border-t"
          aria-labelledby="w-samples"
          id={SAMPLES_ANCHOR}
        >
          <div className="max-w-page gap-block mx-auto grid md:grid-cols-2">
            <div className="max-w-prose">
              <p className="text-eyebrow text-muted font-mono uppercase">
                {WHOLESALE.samplesEyebrow}
              </p>
              <h2
                id="w-samples"
                className="text-display-3 text-primary mt-stack"
              >
                {WHOLESALE.samplesHeading}
              </h2>
              <p className="text-body text-muted mt-block">
                {WHOLESALE.samplesLine}
              </p>
            </div>

            <div className="border-hairline border-t pt-6">
              <h3 className="text-heading-3 text-primary">
                {WHOLESALE.samplesFormHeading}
              </h3>
              <p className="text-body-sm text-muted mt-stack max-w-prose">
                {WHOLESALE.samplesFormLine}
              </p>
              <div className="mt-block">
                <AskForSamples state={signup} sourcePath="/wholesale" />
              </div>
            </div>
          </div>
        </section>
      </main>

      <StoreFooter />
    </>
  );
}
