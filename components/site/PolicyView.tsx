import { formatMoney } from "@/lib/commerce";
import { cx } from "@/components/product/cx";
import shop from "@/components/product/shop.module.css";
import { StoreFooter, StoreHeader } from "@/components/product/StoreChrome";

import { DELIVERY, fill, TERMS } from "./copy";
import { deliveryCharge, deliveryFreeFrom } from "./delivery";
import styles from "./site.module.css";

/**
 * /delivery and /terms.
 *
 * One component, two records, because the two pages are the same shape: a
 * heading, a lede, and a run of short sections a person reads once and never
 * again unless something has gone wrong.
 *
 * ## Why these are short
 *
 * `legal/terms-of-sale.md` and `legal/shipping-returns.md` are the full
 * documents and both still carry `[SQUARE BRACKET]` placeholders — the legal
 * entity, the NZBN, the rural surcharge, the courier cut-off. Their own front
 * matter says not to publish a page with placeholders in it, and it is right:
 * a shipping promise that cannot be met is a misleading representation under
 * Fair Trading Act 1986 s 9.
 *
 * So what is published here is the settled part, and it is the part a first-time
 * buyer sending $54 to a stranger actually wants: what a parcel costs, when it
 * leaves, and what she is owed if it arrives broken. Where a fact is not settled
 * the page says nothing about it rather than guessing — there is no rural
 * surcharge on this page, and no overnight option, because neither has a number
 * yet.
 */

export interface PolicySection {
  readonly heading: string;
  readonly body: string;
}

function Sections({
  sections,
  values,
}: {
  sections: readonly PolicySection[];
  values: Readonly<Record<string, string>>;
}) {
  return (
    <div className="mt-block">
      {sections.map((section) => (
        <section
          key={section.heading}
          className={cx(
            styles.definitions,
            "border-hairline mt-stack border-t pt-4",
          )}
        >
          <h2 className="text-heading-3 text-primary">{section.heading}</h2>
          <p className="text-body text-muted max-w-prose">
            {fill(section.body, values)}
          </p>
        </section>
      ))}
    </div>
  );
}

export function DeliveryView() {
  const values = {
    charge: formatMoney(deliveryCharge()),
    threshold: formatMoney(deliveryFreeFrom()),
  };

  return (
    <>
      <StoreHeader here="policy" />

      <main id="top" className="flex-1">
        <section className="px-gutter pt-block pb-block" aria-labelledby="d-h1">
          <div className="max-w-page mx-auto">
            <p className="text-eyebrow text-muted font-mono uppercase">
              {DELIVERY.eyebrow}
            </p>
            <h1 id="d-h1" className="text-display-2 text-primary mt-stack">
              {DELIVERY.heading}
            </h1>
            <p className="text-lede text-primary mt-stack max-w-prose">
              {DELIVERY.lede}
            </p>

            {/* The three numbers, first, before any prose about them. */}
            <dl className="gap-block mt-block border-hairline flex flex-wrap border-t pt-6">
              <div>
                <dt className="text-caption text-muted">
                  {DELIVERY.chargeLabel}
                </dt>
                <dd
                  className={cx(
                    shop.figure,
                    "text-display-3 text-primary mt-1",
                  )}
                >
                  {values.charge}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-muted">
                  {fill(DELIVERY.freeLabel, values)}
                </dt>
                <dd
                  className={cx(
                    shop.figure,
                    "text-display-3 text-primary mt-1",
                  )}
                >
                  {DELIVERY.freeValue}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-muted">
                  {DELIVERY.dispatchLabel}
                </dt>
                <dd
                  className={cx(
                    shop.figure,
                    "text-display-3 text-primary mt-1",
                  )}
                >
                  {DELIVERY.dispatchValue}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="px-gutter pb-section">
          <div className="max-w-page mx-auto">
            <Sections sections={DELIVERY.sections} values={values} />
          </div>
        </section>
      </main>

      <StoreFooter />
    </>
  );
}

export function TermsView() {
  return (
    <>
      <StoreHeader here="policy" />

      <main id="top" className="flex-1">
        <section className="px-gutter pt-block pb-block" aria-labelledby="t-h1">
          <div className="max-w-page mx-auto">
            <p className="text-eyebrow text-muted font-mono uppercase">
              {TERMS.eyebrow}
            </p>
            <h1 id="t-h1" className="text-display-2 text-primary mt-stack">
              {TERMS.heading}
            </h1>
            <p className="text-lede text-primary mt-stack max-w-prose">
              {TERMS.lede}
            </p>
          </div>
        </section>

        <section className="px-gutter pb-section">
          <div className="max-w-page mx-auto">
            <Sections sections={TERMS.sections} values={{}} />

            <div className="border-hairline mt-section border-t pt-6">
              <h2 className="text-heading-3 text-primary">
                {TERMS.contactHeading}
              </h2>
              <p className="text-body text-muted mt-stack max-w-prose">
                {TERMS.contactLine}
              </p>
              <a
                href="mailto:hello@halfsour.co.nz"
                className={cx(shop.tap, "text-body-sm text-primary mt-stack")}
              >
                <span className={cx(shop.drawLink)}>hello@halfsour.co.nz</span>
              </a>
            </div>
          </div>
        </section>
      </main>

      <StoreFooter />
    </>
  );
}
