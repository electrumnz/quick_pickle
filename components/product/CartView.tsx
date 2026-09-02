import Link from "next/link";

import { fill, DELIVERY } from "@/components/site/copy";
import {
  deliveryCharge,
  deliveryChargeFor,
  deliveryFreeFrom,
} from "@/components/site/delivery";
import {
  addMoney,
  formatMoney,
  type Cart,
  type CartLine,
} from "@/lib/commerce";

import { goToCheckout, removeCartLine, updateCartLine } from "./actions";
import type { CheckoutKind } from "./cart";
import { formatPrice } from "./catalogue";
import { CART, productPath, SHOP_PATH, STATE } from "./copy";
import styles from "./shop.module.css";
import { cx } from "./cx";
import { StoreFooter, StoreHeader } from "./StoreChrome";

/**
 * The cart page.
 *
 * Lines, a quantity control and a remove control per line, the arithmetic,
 * and one button to checkout. Every control is a plain form posting to a
 * Server Action, so the page works with scripting off and the answer comes
 * back as a redirect with the outcome in the query string — the same
 * mechanism the buy path uses everywhere else.
 */

const MAX_QUANTITY = 12;

function Line({ line }: { line: CartLine }) {
  const options = Array.from({ length: MAX_QUANTITY }, (_, i) => i + 1);
  const quantityId = `qty-${line.id}`;
  return (
    <li className="border-hairline gap-stack grid grid-cols-[minmax(0,1fr)_auto] items-start border-t py-5">
      <div className="min-w-0">
        {/* A level-2 heading straight under the page's h1: the lines are the
            page's sections, and axe's heading-order rule holds the cart to
            the same outline as every other page. */}
        <h2 className="text-heading-3 text-primary">
          <Link
            href={productPath(line.merchandise.product.handle)}
            className={cx(styles.tap, "text-primary")}
          >
            <span className={cx(styles.drawLink)}>
              {line.merchandise.product.title}
            </span>
          </Link>
        </h2>
        <p className={cx(styles.figure, "text-caption text-muted mt-1")}>
          {formatPrice(line.cost.amountPerQuantity)} each
        </p>

        <div className="gap-stack mt-stack flex flex-wrap items-center">
          <form
            action={updateCartLine}
            className="gap-inline flex items-center"
          >
            <input type="hidden" name="lineId" value={line.id} />
            <label
              htmlFor={quantityId}
              className="text-eyebrow text-muted font-mono uppercase"
            >
              {CART.lineQuantity}
            </label>
            <select
              id={quantityId}
              name="quantity"
              defaultValue={String(line.quantity)}
              className={cx(styles.qty)}
            >
              {options.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className={cx(styles.tap, "text-body-sm text-primary px-1")}
            >
              <span className={cx(styles.drawLink)}>{CART.update}</span>
            </button>
          </form>
          <form action={removeCartLine}>
            <input type="hidden" name="lineId" value={line.id} />
            <button
              type="submit"
              className={cx(styles.tap, "text-body-sm text-muted px-1")}
            >
              <span className={cx(styles.drawLink)}>{CART.remove}</span>
            </button>
          </form>
        </div>
      </div>

      <p
        className={cx(styles.figure, "text-heading-3 text-primary text-right")}
      >
        {formatPrice(line.cost.totalAmount)}
      </p>
    </li>
  );
}

function Totals({ cart, checkout }: { cart: Cart; checkout: CheckoutKind }) {
  const charge = deliveryCharge();
  const threshold = deliveryFreeFrom();
  const thisOrder = deliveryChargeFor(cart.cost.subtotalAmount);
  // The provider's total is the bottles; the courier is added here, the same
  // way the checkout adds it, so the number on this page is the number on the
  // next one.
  const total = addMoney(cart.cost.totalAmount, thisOrder);

  return (
    <aside
      className="border-hairline bg-surface-raised gap-stack flex h-fit flex-col border p-5 lg:sticky lg:top-[var(--spacing-stack)]"
      aria-label={CART.total}
    >
      <dl className="text-body-sm">
        <div className="border-hairline flex items-baseline justify-between gap-4 border-b py-2">
          <dt className="text-muted">
            {CART.subtotal} · {cart.totalQuantity}{" "}
            {cart.totalQuantity === 1 ? STATE.cartOne : STATE.cartMany}
          </dt>
          <dd className={cx(styles.figure, "text-primary")}>
            {formatPrice(cart.cost.subtotalAmount)}
          </dd>
        </div>
        <div className="border-hairline flex items-baseline justify-between gap-4 border-b py-2">
          <dt className="text-muted">{CART.delivery}</dt>
          <dd className={cx(styles.figure, "text-primary")}>
            {thisOrder.amountInMinorUnits === 0
              ? CART.deliveryFree
              : formatMoney(thisOrder)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-3">
          <dt className="text-body text-primary font-semibold">{CART.total}</dt>
          <dd className={cx(styles.figure, "text-heading-2 text-primary")}>
            {formatPrice(total)}
          </dd>
        </div>
      </dl>
      <p className="text-caption text-muted">
        {CART.totalNote}{" "}
        {fill(DELIVERY.shortLine, {
          charge: formatMoney(charge),
          threshold: formatMoney(threshold),
        })}
      </p>

      {checkout === "unavailable" ? (
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
      ) : (
        <>
          <form action={goToCheckout}>
            <input type="hidden" name="handle" value="" />
            <button
              type="submit"
              className={cx(
                styles.button,
                styles.buttonPrimary,
                styles.buttonBlock,
              )}
            >
              {STATE.checkout}
            </button>
          </form>
          {checkout === "simulated" ? (
            <p className="text-caption text-muted">
              {STATE.checkoutSimulatedNote}
            </p>
          ) : null}
        </>
      )}

      <Link
        href={SHOP_PATH}
        className={cx(styles.tap, "text-body-sm text-primary self-start")}
      >
        <span className={cx(styles.drawLink)}>{CART.continue}</span>
      </Link>
    </aside>
  );
}

export function CartView({
  cart,
  added,
  problem,
  checkout,
}: {
  cart: Cart | null;
  added: { readonly handle: string; readonly quantity: number } | null;
  problem: string | null;
  checkout: CheckoutKind;
}) {
  const lines = cart?.lines ?? [];
  const addedLine =
    added === null
      ? undefined
      : lines.find((line) => line.merchandise.product.handle === added.handle);

  return (
    <>
      <StoreHeader here="cart" />

      <main id="top" className="flex-1">
        <section
          className="px-gutter pt-block pb-section"
          aria-labelledby="cart-h1"
        >
          <div className="max-w-page mx-auto">
            <p className="text-eyebrow text-muted font-mono uppercase">
              {CART.eyebrow}
            </p>
            <h1 id="cart-h1" className="text-display-2 text-primary mt-stack">
              {CART.heading}
            </h1>

            {problem === null ? null : (
              <p
                className="border-danger text-danger text-body-sm mt-block max-w-prose border-l-2 pl-3"
                role="alert"
              >
                {CART.problem[problem] ?? CART.problem.failed}
              </p>
            )}

            {added === null ? null : (
              <p
                className="border-hairline bg-surface-sunken text-body text-primary mt-block flex max-w-prose flex-wrap items-baseline justify-between gap-2 border p-4"
                role="status"
              >
                <span className="font-semibold">{STATE.added}</span>
                <span className={cx(styles.figure, "text-body-sm")}>
                  {addedLine === undefined
                    ? `${String(added.quantity)} added`
                    : `${String(addedLine.quantity)} × ${formatPrice(addedLine.cost.amountPerQuantity)}`}
                </span>
                {cart === null ? null : (
                  <span className="text-caption basis-full">
                    {STATE.cartLabel}: {cart.totalQuantity}{" "}
                    {cart.totalQuantity === 1 ? STATE.cartOne : STATE.cartMany}
                  </span>
                )}
              </p>
            )}

            {cart === null || lines.length === 0 ? (
              <div className="mt-block max-w-prose">
                <p className="text-heading-2 text-primary">
                  {CART.emptyHeading}
                </p>
                <p className="text-body text-muted mt-stack">
                  {CART.emptyNote}
                </p>
                <Link
                  href={SHOP_PATH}
                  className={cx(
                    styles.button,
                    styles.buttonPrimary,
                    "mt-block",
                  )}
                >
                  {CART.emptyAction}
                </Link>
              </div>
            ) : (
              <div className="gap-block mt-block grid lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
                <ul className="border-hairline border-b">
                  {lines.map((line) => (
                    <Line key={line.id} line={line} />
                  ))}
                </ul>
                <Totals cart={cart} checkout={checkout} />
              </div>
            )}
          </div>
        </section>
      </main>

      <StoreFooter />
    </>
  );
}
