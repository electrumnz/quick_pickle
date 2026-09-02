import Image from "next/image";

import { BottlePlate, type PlateVariant } from "./BottlePlate";
import { FilmMount } from "./FilmMount";
import { PRODUCT } from "./copy";
import { BOTTLE_SHOTS } from "./media";
import { SetPlate } from "./SetPlate";
import styles from "./shop.module.css";

/**
 * The product page's picture of the bottle.
 *
 * A photograph, layered with the clip cut from the same frame. It replaces the
 * WebGL viewer in this slot for the same reason the homepage dropped it: the
 * render carried a blank paper band where the label art belongs, and a
 * storefront's job is to show the thing being sold. The 3D system is not
 * deleted — `ProductViewer` is whole and `/lab/bottle` still runs it.
 *
 * Two variants have no photograph and are honest about it. The set is three
 * bottles in a box and the range shot has four in it, so using the range shot
 * to sell the set would misstate what is in it — Fair Trading Act s 13(a) is
 * about composition and quantity, and a picture is a representation. Those
 * fall back to the drawn plate until the box has been photographed.
 */
export function ProductMedia({
  variant,
  label,
  className,
}: {
  variant: PlateVariant;
  /** Alt text used for the drawn fallback plate. */
  label: string;
  className?: string;
}) {
  const shot =
    variant === "set" || variant === "plain" ? null : BOTTLE_SHOTS[variant];

  return (
    <figure className={className}>
      <div className={`${styles.plate} ${styles.viewerPlate}`}>
        {variant === "set" ? (
          <SetPlate className="h-full" sizes="(max-width: 64rem) 30vw, 213px" />
        ) : shot === null ? (
          <BottlePlate
            variant={variant}
            label={label}
            className={styles.plateArt}
          />
        ) : (
          // One positioned box for both layers. `.plate > *` sets
          // `position: relative` on its direct children, so the still and the
          // clip are stacked inside a wrapper rather than against the plate.
          <div className={styles.photoLayer}>
            <Image
              src={shot.still}
              alt={shot.alt}
              width={shot.width}
              height={shot.height}
              // The largest this box ever gets is one column of a two-column
              // page, so it is never asked for a full-viewport width above the
              // breakpoint where the columns split.
              sizes="(max-width: 64rem) 92vw, 640px"
              priority
              className={styles.photo}
            />
            <FilmMount shot={shot} fit="cover" />
          </div>
        )}
      </div>

      <figcaption className="text-caption text-muted mt-3">
        {/* Announced rather than silently substituted, and gated in CSS so the
            claim is only made when it is true. */}
        <span className="hidden reduce-motion:inline">
          {PRODUCT.viewerStill}
        </span>
      </figcaption>
    </figure>
  );
}
