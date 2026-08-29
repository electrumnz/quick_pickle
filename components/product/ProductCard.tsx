import Link from "next/link";

import { AvailabilityChip, PriceBlock } from "./bits";
import { BottlePlate, type PlateVariant } from "./BottlePlate";
import { BuyForm } from "./BuyPanel";
import type { CatalogueEntry } from "./catalogue";
import { productPath, SHOP, SHOP_PATH, STATE } from "./copy";
import styles from "./shop.module.css";
import { cx } from "./cx";

/**
 * One bottle on the shelf.
 *
 * The hierarchy is the whole point of this component, and it is deliberately
 * upside down compared with most storefronts: the JOB is the largest thing on
 * the card, above the name and above the price. Somebody arriving here has
 * never heard of No. 02 and is not choosing on a number — they are choosing on
 * "I am making a martini". The number, the descriptor, the notes and the price
 * are all still there, in that order, once the job has done its work.
 *
 * The whole card is a link to the product page, and the add-to-cart form inside
 * it is a separate target that sits above the link overlay — so a shopper who
 * has already decided never has to open the page at all.
 */

function plateVariantFor(entry: CatalogueEntry): PlateVariant {
  if (entry.kind === "set") return "set";
  return entry.brine?.id ?? "plain";
}

export function ProductCard({
  entry,
  degraded,
}: {
  entry: CatalogueEntry;
  degraded: boolean;
}) {
  const href = productPath(entry.handle);
  const headingId = `card-${entry.handle}`;

  return (
    <article className={cx(styles.card)} aria-labelledby={headingId}>
      <div className={cx(styles.plate, styles.cardMedia)}>
        <BottlePlate
          variant={plateVariantFor(entry)}
          label=""
          className={styles.plateArt}
        />
      </div>

      <div className={styles.cardBody}>
        <p className="text-eyebrow text-muted font-mono uppercase">
          {entry.kind === "set" ? SHOP.cardBoxEyebrow : SHOP.cardForEyebrow}
        </p>

        {/* The link that covers the card. Everything else in the card is
            decoration around this one destination, which is why the accessible
            name is the job AND the bottle rather than "read more". */}
        <h3 id={headingId} className="text-heading-2 text-primary">
          <Link href={href} className={cx(styles.cardLink, "outline-none")}>
            {entry.job}
            <span className="sr-only"> — {entry.title}</span>
          </Link>
        </h3>

        <p className={cx(styles.figure, "text-caption text-muted uppercase")}>
          {entry.title}
          {entry.descriptor === null ? null : ` · ${entry.descriptor}`}
        </p>

        {entry.line === null ? null : (
          <p className="text-body-sm text-primary">{entry.line}</p>
        )}

        {/* Four tasting notes are a luxury a 200px column does not have. They
            return at 768, where the card is tall enough to carry them. */}
        {entry.brine === null ? null : (
          <ul className="gap-inline text-caption text-muted mt-1 hidden flex-wrap md:flex">
            {entry.brine.notes.slice(0, 4).map((note) => (
              <li
                key={note}
                className="after:ml-2 after:content-['·'] last:after:content-['']"
              >
                {note}
              </li>
            ))}
          </ul>
        )}

        {entry.supplyLimited && !degraded ? (
          <p className="text-caption text-muted">{STATE.supplyLimitedNote}</p>
        ) : null}

        <div className="gap-stack mt-auto flex flex-wrap items-end justify-between pt-2">
          <PriceBlock entry={entry} range />
          <AvailabilityChip entry={entry} />
        </div>

        <div className={cx(styles.cardControls, "mt-2")}>
          {degraded ? (
            <Link
              href={href}
              className={cx(
                styles.button,
                styles.buttonSecondary,
                styles.buttonBlock,
              )}
            >
              {SHOP.readInstead}
            </Link>
          ) : (
            <BuyForm entry={entry} returnTo={`${SHOP_PATH}#added`} compact />
          )}
        </div>
      </div>
    </article>
  );
}
