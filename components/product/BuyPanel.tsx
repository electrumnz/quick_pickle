import Link from "next/link";

import type { Cart } from "@/lib/commerce";

import { addToCart, goToCheckout } from "./actions";
import { formatPrice, type CatalogueEntry } from "./catalogue";
import { PRODUCT, SHOP_PATH, STATE } from "./copy";
import { AvailabilityChip, PriceBlock } from "./bits";
import { drinksPerBottle } from "./serves";
import { SubmitButton } from "./SubmitButton";
import styles from "./shop.module.css";
import { cx } from "./cx";

/**
 * The buy control.
 *
 * A plain `<form>` posting to a Server Action, so the whole path — choose a
 * variant, choose a quantity, add it, go to checkout — works with JavaScript
 * switched off. Nothing in the form carries a price. It carries a variant id
 * and a number, and the provider prices the line itself.
 *
 * Four states are designed rather than defaulted, and all four occupy the same
 * place in the layout so the answer is always in the same spot:
 *
 *   sellable   the accent button.
 *   sold out   the same button shape, inert, with the reason underneath and a
 *              route to the rest of the range rather than a dead end.
 *   unlisted   in the range, no sellable variant in the catalogue. Same shape;
 *              for WILD the reason is the leaf supply, stated as a fact.
 *   degraded   the catalogue could not be reached at all, so ordering is
 *              withdrawn instead of being offered at a guessed price.
 */

const MAX_QUANTITY = 12;

function VariantChoice({ entry }: { entry: CatalogueEntry }) {
  const { variants, variant } = entry;

  // One variant is not a choice, and a select with a single option is a
  // control that cannot be operated. State the fact and post it as a hidden
  // field instead.
  if (variants.length <= 1) {
    return (
      <>
        <input type="hidden" name="variantId" value={variant?.id ?? ""} />
        {variant === null ? null : (
          <p className="text-caption text-muted">{STATE.onlyOption}</p>
        )}
      </>
    );
  }

  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="text-eyebrow text-muted mb-2 font-mono uppercase">
        {STATE.size}
      </legend>
      <div className={cx(styles.optionSet)}>
        {variants.map((option) => (
          <label key={option.id} className={cx(styles.optionPill)}>
            <input
              className={cx(styles.optionInput)}
              type="radio"
              name="variantId"
              value={option.id}
              defaultChecked={option.id === variant?.id}
              disabled={!option.availableForSale}
            />
            <span className={cx(styles.optionText, "text-body-sm")}>
              {option.title}
            </span>
            <span className={cx(styles.figure, "text-caption")}>
              {formatPrice(option.price)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function QuantityChoice({ max }: { max: number }) {
  const options = Array.from(
    { length: Math.max(1, Math.min(MAX_QUANTITY, max)) },
    (_, index) => index + 1,
  );
  return (
    <div className="gap-inline flex items-center">
      <label
        htmlFor="quantity"
        className="text-eyebrow text-muted font-mono uppercase"
      >
        {STATE.quantity}
      </label>
      <select
        id="quantity"
        name="quantity"
        defaultValue="1"
        className={cx(styles.qty)}
      >
        {options.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </div>
  );
}

export function BuyForm({
  entry,
  returnTo,
  compact = false,
}: {
  entry: CatalogueEntry;
  /** Where to come back to. The action refuses anything not same-origin. */
  returnTo: string;
  /** The sticky bar: one button, no legend, no quantity. */
  compact?: boolean;
}) {
  const sellable =
    entry.variant !== null && entry.variant.availableForSale === true;

  if (!sellable) {
    return (
      <div className={compact ? "flex-1" : undefined}>
        <p
          className={cx(
            styles.button,
            styles.buttonInert,
            compact ? undefined : styles.buttonBlock,
          )}
          aria-live="polite"
        >
          {entry.availability === "unlisted" ? STATE.unlisted : STATE.soldOut}
        </p>
      </div>
    );
  }

  const cap =
    entry.quantityAvailable === null ? MAX_QUANTITY : entry.quantityAvailable;

  return (
    <form
      action={addToCart}
      className={
        compact ? "flex flex-1 items-center gap-3" : "gap-stack flex flex-col"
      }
    >
      <input type="hidden" name="handle" value={entry.handle} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {compact ? (
        <>
          <input type="hidden" name="variantId" value={entry.variant?.id} />
          <input type="hidden" name="quantity" value="1" />
        </>
      ) : (
        <>
          <VariantChoice entry={entry} />
          <QuantityChoice max={cap} />
        </>
      )}
      <SubmitButton price={formatPrice(entry.price)} block={!compact} />
    </form>
  );
}

/**
 * The confirmation strip.
 *
 * Shown after a successful add, from the cart the provider actually holds —
 * quantity, line total and cart total are read back rather than echoed from the
 * form, so what the buyer sees is what the server recorded.
 */
export function AddedStrip({
  cart,
  handle,
  quantity,
  checkoutLive,
}: {
  cart: Cart | null;
  handle: string;
  quantity: number;
  /** False while the store has no hosted checkout behind it. Stated, not hidden. */
  checkoutLive: boolean;
}) {
  const line = cart?.lines.find(
    (candidate) => candidate.merchandise.product.handle === handle,
  );

  return (
    <div
      className="border-hairline bg-surface-sunken gap-stack flex flex-col p-4"
      role="status"
    >
      <div className="gap-stack flex flex-wrap items-baseline justify-between">
        <p className="text-body text-primary font-semibold">{STATE.added}</p>
        <p className={cx(styles.figure, "text-body-sm text-primary")}>
          {line === undefined
            ? `${String(quantity)} added`
            : `${String(line.quantity)} × ${formatPrice(line.cost.amountPerQuantity)}`}
        </p>
      </div>

      {cart === null ? null : (
        <div className="gap-stack flex flex-wrap items-baseline justify-between">
          <p className="text-caption text-primary">
            {STATE.cartLabel}: {cart.totalQuantity}{" "}
            {cart.totalQuantity === 1 ? STATE.cartOne : STATE.cartMany}
          </p>
          <p className={cx(styles.figure, "text-heading-3 text-primary")}>
            {formatPrice(cart.cost.totalAmount)}
          </p>
        </div>
      )}

      {checkoutLive ? (
        <form action={goToCheckout}>
          <input type="hidden" name="handle" value={handle} />
          <button
            type="submit"
            className={cx(
              styles.button,
              styles.buttonSecondary,
              styles.buttonBlock,
            )}
          >
            {STATE.checkout}
          </button>
        </form>
      ) : (
        <>
          <p
            className={cx(
              styles.button,
              styles.buttonInert,
              styles.buttonBlock,
            )}
          >
            {STATE.checkoutNotLive}
          </p>
          <p className="text-caption text-primary">
            {STATE.checkoutNotLiveNote}
          </p>
        </>
      )}

      <Link
        href={SHOP_PATH}
        className={cx(styles.tap, "text-body-sm text-primary self-start")}
      >
        <span className={cx(styles.drawLink)}>{STATE.keepShopping}</span>
      </Link>
    </div>
  );
}

/**
 * The whole right-hand column of a product page: identity, price, the control
 * and whatever the current state has to say about it.
 */
export function BuyPanel({
  entry,
  returnTo,
  degraded,
  cart,
  added,
  problem,
  checkoutLive,
}: {
  entry: CatalogueEntry;
  returnTo: string;
  degraded: boolean;
  cart: Cart | null;
  added: number | null;
  problem: string | null;
  checkoutLive: boolean;
}) {
  const yieldInfo =
    entry.brine === null
      ? null
      : drinksPerBottle(entry.brine.id, entry.volumeMl);

  return (
    <div className="gap-stack flex flex-col">
      <div className="gap-stack flex flex-wrap items-end justify-between">
        <PriceBlock entry={entry} size="lg" />
        <AvailabilityChip entry={entry} />
      </div>

      {problem === null ? null : (
        <p
          className="border-danger text-danger text-body-sm border-l-2 pl-3"
          role="alert"
        >
          {problem}
        </p>
      )}

      {degraded ? (
        <div className="border-hairline bg-surface-sunken p-4">
          <p className="text-body text-primary font-semibold">
            {STATE.degradedHeading}
          </p>
          <p className="text-body-sm text-primary mt-2">{STATE.degradedNote}</p>
        </div>
      ) : added !== null ? (
        <AddedStrip
          cart={cart}
          handle={entry.handle}
          quantity={added}
          checkoutLive={checkoutLive}
        />
      ) : (
        <BuyForm entry={entry} returnTo={returnTo} />
      )}

      {/* When commerce is unreachable EVERY bottle reads as unavailable, and
          the reason is the one in the panel above. Explaining it a second time
          in the language of stock would be telling the reader something that is
          not the case. */}
      {degraded ? null : (
        <>
          {entry.availability === "sold-out" ? (
            <p className="text-body-sm text-muted">{STATE.soldOutNote}</p>
          ) : null}

          {entry.availability === "unlisted" ? (
            <p className="text-body-sm text-muted">
              {entry.supplyLimited
                ? STATE.supplyLimitedNote
                : STATE.unlistedNote}
            </p>
          ) : null}

          {entry.availability !== "unlisted" && entry.supplyLimited ? (
            <p className="text-body-sm text-muted">{STATE.supplyLimitedNote}</p>
          ) : null}
        </>
      )}

      {yieldInfo === null ? null : (
        <p className="text-body-sm text-primary">
          {PRODUCT.yieldLead}{" "}
          <span className={cx(styles.figure)}>{yieldInfo.count}</span> ×{" "}
          {yieldInfo.title}, at{" "}
          <span className={cx(styles.figure)}>{yieldInfo.perServeMl} ml</span>{" "}
          {PRODUCT.yieldTail}.
        </p>
      )}

      <dl className="mt-stack border-hairline text-body-sm border-t">
        {entry.variant === null ? null : (
          <div className="border-hairline flex items-baseline justify-between gap-4 border-b py-2">
            <dt className="text-muted">{PRODUCT.skuLabel}</dt>
            <dd className={cx(styles.figure)}>{entry.variant.sku}</dd>
          </div>
        )}
        {entry.variant?.selectedOptions.map((option) => (
          <div
            key={option.name}
            className="border-hairline flex items-baseline justify-between gap-4 border-b py-2"
          >
            <dt className="text-muted">{option.name}</dt>
            <dd className={cx(styles.figure)}>{option.value}</dd>
          </div>
        ))}
        <div className="border-hairline flex items-baseline justify-between gap-4 border-b py-2">
          <dt className="text-muted">{PRODUCT.priceShownLabel}</dt>
          <dd className={cx(styles.figure)}>{PRODUCT.priceShownValue}</dd>
        </div>
      </dl>

      <p className="text-caption text-muted">{PRODUCT.specLine}</p>
    </div>
  );
}
