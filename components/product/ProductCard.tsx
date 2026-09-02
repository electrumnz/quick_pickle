import Image from "next/image";
import Link from "next/link";

import { AvailabilityChip, PriceBlock } from "./bits";
import { BuyForm } from "./BuyPanel";
import type { CatalogueEntry } from "./catalogue";
import { productPath, SHOP, SHOP_PATH, STATE } from "./copy";
import { BOTTLE_SHOTS } from "./media";
import { SetPlate } from "./SetPlate";
import styles from "./shop.module.css";
import { cx } from "./cx";

/**
 * One bottle on the shelf.
 *
 * The hierarchy is the whole point of this component, and it is deliberately
 * upside down compared with most storefronts: the JOB is the largest thing on
 * the card, above the name and above the price. Somebody arriving here has
 * never heard of No. 02 and is not choosing on a number — they are choosing on
 * "I am making a martini". The number, the descriptor and the price are still
 * there, in that order, once the job has done its work.
 *
 * And that is all that is there. The card used to carry nine things — the
 * one-line, four tasting notes, a supply note, the unit price — and the eye
 * had nowhere to land. Those belong on the product page, where there is room
 * to read them.
 *
 * The whole card is a link to the product page, and the add-to-cart form inside
 * it is a separate target that sits above the link overlay — so a shopper who
 * has already decided never has to open the page at all.
 */

export function ProductCard({
  entry,
  degraded,
}: {
  entry: CatalogueEntry;
  degraded: boolean;
}) {
  const href = productPath(entry.handle);
  const headingId = `card-${entry.handle}`;
  // Cards carry the still only. Five clips on one shelf is five video decoders
  // for a picture nobody has asked to see moving yet; the film is on the
  // product page, where the bottle is the subject.
  const shot = entry.brine === null ? null : BOTTLE_SHOTS[entry.brine.id];

  return (
    <article className={cx(styles.card)} aria-labelledby={headingId}>
      <div className={cx(styles.plate, styles.cardMedia)}>
        {shot === null ? (
          <SetPlate
            className="h-full"
            sizes="(max-width: 48rem) 3rem, (max-width: 80rem) 16vw, 8vw"
          />
        ) : (
          <div className={styles.photoLayer}>
            {/* Decorative here, not descriptive: the heading beside it already
                names the bottle, and the link's accessible name is the job plus
                the title. A second reading of the same product would be noise
                in a list of five. */}
            <Image
              src={shot.still}
              alt=""
              width={shot.width}
              height={shot.height}
              sizes="(max-width: 48rem) 7rem, (max-width: 80rem) 46vw, 24vw"
              className={styles.photo}
            />
          </div>
        )}
      </div>

      <div className={styles.cardBody}>
        <p className="text-eyebrow text-muted font-mono uppercase">
          {entry.kind === "set" ? SHOP.cardBoxEyebrow : SHOP.cardForEyebrow}
        </p>

        {/* The link that covers the card. Everything else in the card is
            decoration around this one destination, which is why the accessible
            name is the job AND the bottle rather than "read more". */}
        <h3
          id={headingId}
          className={cx(styles.cardTitle, "text-heading-2 text-primary")}
        >
          <Link href={href} className={cx(styles.cardLink, "outline-none")}>
            {entry.job}
            <span className="sr-only">, {entry.title}</span>
          </Link>
        </h3>

        <p className={cx(styles.figure, "text-caption text-muted uppercase")}>
          {entry.title}
          {entry.descriptor === null ? null : ` · ${entry.descriptor}`}
        </p>

        {/* The one line stays: it is the sentence that tells a stranger
            which bottle is hers, and lib/strategy/audit.ts checks it sits
            beside the name. The tasting notes and the unit price do not. */}
        {entry.line === null ? null : (
          <p className="text-body-sm text-primary">{entry.line}</p>
        )}

        {entry.supplyLimited && !degraded ? (
          <p className="text-caption text-muted">{STATE.supplyLimitedNote}</p>
        ) : null}

        <div className="gap-stack mt-auto flex flex-wrap items-end justify-between pt-2">
          <PriceBlock entry={entry} range compact />
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
