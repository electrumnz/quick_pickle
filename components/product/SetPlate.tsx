import Image from "next/image";

import type { BrineId } from "@/content/types";

import { BOTTLE_SHOTS } from "./media";
import styles from "./shop.module.css";
import { cx } from "./cx";

/**
 * The box, shown as the three bottles it holds.
 *
 * There is no photograph of the box, and the drawn plate that stood in for one
 * — three flat vector bottles, one of them amber — sat beside four real
 * photographs on the shop page and read as a placeholder from another brand.
 * This is the three bottle shots, cropped to the bottle and set side by side
 * on the same slate ground, which is what a box of them looks like.
 *
 * Decorative: the heading beside it always names the box, so the images carry
 * empty alt text and the whole plate is hidden from the tree.
 */
const IN_THE_BOX: readonly BrineId[] = [
  "no-01-house",
  "no-02-dirty",
  "no-03-smoke",
];

export function SetPlate({
  className,
  sizes,
}: {
  className?: string;
  /** The `sizes` hint for ONE of the three cells. */
  sizes: string;
}) {
  return (
    <div className={cx(styles.setPlate, className)} aria-hidden="true">
      {IN_THE_BOX.map((id) => (
        <div key={id} className={cx(styles.setCell)}>
          <Image
            src={BOTTLE_SHOTS[id].still}
            alt=""
            fill
            sizes={sizes}
            className={cx(styles.setArt)}
          />
        </div>
      ))}
    </div>
  );
}
