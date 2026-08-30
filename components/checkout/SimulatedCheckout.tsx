import type { ReactNode } from "react";
import Link from "next/link";

import { DEMO_BANNER } from "@/components/demo/copy";
import { DeliveryLine } from "@/components/product/BuyPanel";
import { SHOP_PATH, STATE } from "@/components/product/copy";
import { cx } from "@/components/product/cx";
import shop from "@/components/product/shop.module.css";
import { StoreFooter, StoreHeader } from "@/components/product/StoreChrome";
import site from "@/components/site/site.module.css";
import {
  addMoney,
  compareMoney,
  formatMoney,
  money,
  type Cart,
  type Money,
  type Order,
} from "@/lib/commerce";

import { CheckoutProblem } from "./CheckoutProblem";
import { CHECKOUT_PROBLEM_ANCHOR } from "./link";
import { CHECKOUT, CHECKOUT_PROBLEM } from "./copy";
import { placeSimulatedOrder } from "./actions";
import type { CheckoutField } from "./validate";

/**
 * The simulated checkout, as a buyer sees it.
 *
 * ## What this screen is for
 *
 * The mock and demo providers have always advertised a checkout URL and the app
 * has never served it, so the storefront had to withdraw the button and the
 * cart went nowhere. This is that route. It completes the cart through the same
 * `CheckoutSimulator` the conformance suite and the seed already use, so the
 * order it produces is the same order, written by the same transaction, and it
 * arrives in `/admin/orders` like any other.
 *
 * ## What it must never look like
 *
 * A payment page. There is no card number here, no expiry, no security code, no
 * payment-provider mark and no word that implies money moved — see
 * `./copy.ts`. The one thing this page has to succeed at, before it is useful
 * at all, is being unmistakable: a person arriving from an "add to cart" button
 * expects to be asked for a card next, so the first thing on the screen is the
 * demo banner's own tag and sentence, and the first heading says that nothing
 * here takes payment.
 *
 * ## Accessibility
 *
 * Every field has a real `<label for>`, an `autoComplete` token and its own
 * error path. A refused submission redirects to `#checkout-problem`, and the
 * block with that id carries `tabIndex={-1}` — so the browser moves focus onto
 * the explanation with no script running at all, which matters because this
 * form is built to work with JavaScript switched off. The field the problem
 * belongs to is marked `aria-invalid` and described by the same block.
 */

/* ------------------------------------------------------------------ notice */

/**
 * The demo banner's words, at the top of the page instead of the foot of it.
 *
 * Reused rather than rewritten: a visitor has read this sentence at the bottom
 * of every page they have been on, and meeting the same words here is what
 * makes it read as the same statement rather than a new one to evaluate.
 */
function SimulationNotice() {
  return (
    <p className="border-accent-edge bg-surface-accent text-on-accent text-body-sm gap-x-2 border p-4">
      <strong className="font-semibold tracking-wide uppercase">
        {DEMO_BANNER.tag}
      </strong>{" "}
      {DEMO_BANNER.body}
    </p>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <StoreHeader />
      <main className="px-gutter py-section flex-1">
        <div className="max-w-page mx-auto">{children}</div>
      </main>
      <StoreFooter />
    </>
  );
}

function BackToShop() {
  return (
    <Link
      href={SHOP_PATH}
      className={cx(shop.tap, "text-body-sm text-primary w-fit")}
    >
      <span className={cx(shop.drawLink)}>{CHECKOUT.keepShopping}</span>
    </Link>
  );
}

/* ------------------------------------------------------------- dead ends */

/**
 * A link that no longer names a live cart in this browser, and an empty cart.
 *
 * Both say the same load-bearing thing — nothing was recorded and nothing was
 * charged — because a person who has just pressed a button on something called
 * a checkout and landed on an error deserves to be told that before anything
 * else.
 */
export function CheckoutDeadEnd({ reason }: { reason: "gone" | "empty" }) {
  const heading =
    reason === "gone" ? CHECKOUT.goneHeading : CHECKOUT.emptyHeading;
  const body = reason === "gone" ? CHECKOUT.goneBody : CHECKOUT.emptyBody;

  return (
    <Shell>
      <SimulationNotice />
      <h1 className="text-heading-2 text-primary mt-block">{heading}</h1>
      <p className="text-body text-primary mt-stack max-w-prose">{body}</p>
      <div className="mt-block">
        <BackToShop />
      </div>
    </Shell>
  );
}

/* --------------------------------------------------------------- summary */

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="border-hairline flex items-baseline justify-between gap-4 border-b py-2">
      <dt className={strong ? "text-primary font-semibold" : "text-muted"}>
        {label}
      </dt>
      <dd
        className={cx(
          shop.figure,
          strong ? "text-primary font-semibold" : "text-primary",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * What the cart holds, priced by the provider.
 *
 * Every figure is a `Money` — integer minor units — formatted by `formatMoney`,
 * which does its arithmetic in `BigInt` and never divides by 100. The estimated
 * grand total is one integer addition of two of them. No float appears on this
 * page at any point, which is the rule `lib/commerce/money.ts` exists to keep.
 *
 * It is called an estimate on purpose: the provider recomputes the whole thing
 * from the catalogue when the cart is converted, and the order it writes is the
 * only authority on what was recorded.
 */
function CartSummary({ cart, delivery }: { cart: Cart; delivery: Money }) {
  const subtotal = cart.cost.subtotalAmount;
  const discount = money(
    subtotal.amountInMinorUnits - cart.cost.totalAmount.amountInMinorUnits,
    cart.currencyCode,
  );
  const hasDiscount = discount.amountInMinorUnits > 0;
  const carried = delivery.amountInMinorUnits === 0;

  return (
    <section aria-labelledby="checkout-summary-h2">
      <h2
        id="checkout-summary-h2"
        className="text-eyebrow text-muted border-hairline border-b pb-3 font-mono uppercase"
      >
        {CHECKOUT.summaryHeading}
      </h2>

      <ul className="mt-stack">
        {cart.lines.map((line) => (
          <li
            key={line.id}
            className="border-hairline flex items-baseline justify-between gap-4 border-b py-3"
          >
            <span className="text-body text-primary">
              <span className={cx(shop.figure)}>{line.quantity}</span> ×{" "}
              {line.merchandise.product.title}
            </span>
            <span className={cx(shop.figure, "text-body text-primary")}>
              {formatMoney(line.cost.totalAmount)}
            </span>
          </li>
        ))}
      </ul>

      <dl className="text-body-sm mt-stack">
        <SummaryRow
          label={CHECKOUT.subtotalLabel}
          value={formatMoney(subtotal)}
        />
        {hasDiscount ? (
          <SummaryRow
            label={CHECKOUT.discountLabel}
            value={`−${formatMoney(discount)}`}
          />
        ) : null}
        <SummaryRow
          label={CHECKOUT.deliveryLabel}
          value={carried ? CHECKOUT.deliveryFreeValue : formatMoney(delivery)}
        />
        <SummaryRow
          label={CHECKOUT.totalLabel}
          value={formatMoney(addMoney(cart.cost.totalAmount, delivery))}
          strong
        />
      </dl>

      <p className="text-caption text-muted mt-stack max-w-prose">
        {CHECKOUT.totalNote}
      </p>
      <DeliveryLine className="mt-stack max-w-prose" />
    </section>
  );
}

/* ------------------------------------------------------------------ form */

function Field({
  id,
  name,
  label,
  type = "text",
  autoComplete,
  required = false,
  maxLength,
  inputMode,
  pattern,
  invalid = false,
  hint,
}: {
  id: string;
  name: string;
  label: string;
  type?: "text" | "email" | "tel";
  autoComplete: string;
  required?: boolean;
  maxLength: number;
  inputMode?: "email" | "tel" | "numeric";
  pattern?: string;
  invalid?: boolean;
  hint?: string;
}) {
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const describedBy = [hintId, invalid ? CHECKOUT_PROBLEM_ANCHOR : undefined]
    .filter((value): value is string => value !== undefined)
    .join(" ");

  return (
    <div>
      <label
        htmlFor={id}
        className="text-eyebrow text-muted font-mono uppercase"
      >
        {label}
        {required ? null : (
          <span className="lowercase"> ({CHECKOUT.optionalSuffix})</span>
        )}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        className={cx(site.field)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        pattern={pattern}
        required={required}
        maxLength={maxLength}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy === "" ? undefined : describedBy}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="text-caption text-muted mt-1">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Which field a problem code points at, so only that one is marked invalid. */
const PROBLEM_FIELD: Readonly<Record<string, CheckoutField>> = {
  email: "email",
  name: "name",
  address: "address",
  postcode: "postcode",
};

export function SimulatedCheckoutForm({
  cart,
  delivery,
  problem,
}: {
  cart: Cart;
  delivery: Money;
  /** A `CHECKOUT_PROBLEM` code from the query string, or null. */
  problem: string | null;
}) {
  const said = problem === null ? null : (CHECKOUT_PROBLEM[problem] ?? null);
  const field = problem === null ? null : (PROBLEM_FIELD[problem] ?? null);

  return (
    <Shell>
      <SimulationNotice />

      <p className="text-eyebrow text-muted mt-block font-mono uppercase">
        {CHECKOUT.eyebrow}
      </p>
      <h1 className="text-display-3 text-primary mt-2">{CHECKOUT.heading}</h1>
      <p className="text-body text-primary mt-stack max-w-prose">
        {CHECKOUT.lede}
      </p>
      <p className="text-body-sm text-muted mt-stack max-w-prose">
        {CHECKOUT.whyAddress}
      </p>

      {said === null ? null : <CheckoutProblem said={said} />}

      <div className="gap-block mt-block grid md:grid-cols-2">
        <CartSummary cart={cart} delivery={delivery} />

        <section aria-labelledby="checkout-form-h2">
          <h2
            id="checkout-form-h2"
            className="text-eyebrow text-muted border-hairline border-b pb-3 font-mono uppercase"
          >
            {CHECKOUT.formHeading}
          </h2>

          <form
            action={placeSimulatedOrder}
            className="gap-stack mt-stack flex flex-col"
          >
            <Field
              id="checkout-email"
              name="email"
              label={CHECKOUT.emailLabel}
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              maxLength={254}
              invalid={field === "email"}
              hint={CHECKOUT.emailHint}
            />

            <div className="gap-stack grid sm:grid-cols-2">
              <Field
                id="checkout-first-name"
                name="firstName"
                label={CHECKOUT.firstNameLabel}
                autoComplete="given-name"
                required
                maxLength={100}
                invalid={field === "name"}
              />
              <Field
                id="checkout-last-name"
                name="lastName"
                label={CHECKOUT.lastNameLabel}
                autoComplete="family-name"
                required
                maxLength={100}
                invalid={field === "name"}
              />
            </div>

            <Field
              id="checkout-line1"
              name="line1"
              label={CHECKOUT.line1Label}
              autoComplete="address-line1"
              required
              maxLength={200}
              invalid={field === "address"}
            />
            <Field
              id="checkout-line2"
              name="line2"
              label={CHECKOUT.line2Label}
              autoComplete="address-line2"
              maxLength={200}
              invalid={field === "address"}
            />

            <div className="gap-stack grid sm:grid-cols-2">
              <Field
                id="checkout-suburb"
                name="suburb"
                label={CHECKOUT.suburbLabel}
                autoComplete="address-level3"
                maxLength={120}
                invalid={field === "address"}
              />
              <Field
                id="checkout-city"
                name="city"
                label={CHECKOUT.cityLabel}
                autoComplete="address-level2"
                required
                maxLength={120}
                invalid={field === "address"}
              />
            </div>

            <div className="gap-stack grid sm:grid-cols-2">
              <Field
                id="checkout-postcode"
                name="postcode"
                label={CHECKOUT.postcodeLabel}
                autoComplete="postal-code"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={16}
                invalid={field === "postcode"}
              />
              <Field
                id="checkout-phone"
                name="phone"
                label={CHECKOUT.phoneLabel}
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                maxLength={40}
              />
            </div>

            <div>
              <label
                htmlFor="checkout-note"
                className="text-eyebrow text-muted font-mono uppercase"
              >
                {CHECKOUT.noteLabel}
                <span className="lowercase"> ({CHECKOUT.optionalSuffix})</span>
              </label>
              <textarea
                id="checkout-note"
                name="note"
                rows={3}
                maxLength={500}
                className={cx(site.field)}
              />
            </div>

            <p className="text-caption text-muted">{CHECKOUT.countryLine}</p>

            <button
              type="submit"
              className={cx(shop.button, shop.buttonPrimary, shop.buttonBlock)}
            >
              {CHECKOUT.submit}
            </button>
            <p className="text-caption text-primary">{CHECKOUT.submitNote}</p>
          </form>

          <div className="mt-block">
            <BackToShop />
          </div>
        </section>
      </div>
    </Shell>
  );
}

/* --------------------------------------------------------------- receipt */

/**
 * The order, read back from the provider.
 *
 * Every number here comes off the `Order` row rather than off the cart the
 * buyer was looking at a moment ago: the provider reprices inside the
 * transaction that writes it, and the order is the only authority on what was
 * recorded. It is also the row `/admin/orders` reads, which is the whole point
 * of the exercise.
 */
export function SimulatedOrderPlaced({
  order,
  adminOpen,
}: {
  order: Order;
  /** True on a demonstration whose admin needs no password. */
  adminOpen: boolean;
}) {
  const carried = order.shippingTotal.amountInMinorUnits === 0;

  return (
    <Shell>
      <SimulationNotice />

      <p className="text-eyebrow text-muted mt-block font-mono uppercase">
        {CHECKOUT.placedEyebrow}
      </p>
      <h1 className="text-display-3 text-primary mt-2">
        {CHECKOUT.placedHeading}
      </h1>
      <p className="text-body text-primary mt-stack max-w-prose">
        {CHECKOUT.placedBody}
      </p>

      <div className="gap-block mt-block grid md:grid-cols-2">
        <section aria-labelledby="checkout-placed-h2">
          <h2
            id="checkout-placed-h2"
            className="text-eyebrow text-muted border-hairline border-b pb-3 font-mono uppercase"
          >
            {CHECKOUT.summaryHeading}
          </h2>

          <ul className="mt-stack">
            {order.lineItems.map((line) => (
              <li
                key={line.id}
                className="border-hairline flex items-baseline justify-between gap-4 border-b py-3"
              >
                <span className="text-body text-primary">
                  <span className={cx(shop.figure)}>{line.quantity}</span> ×{" "}
                  {line.title}
                </span>
                <span className={cx(shop.figure, "text-body text-primary")}>
                  {formatMoney(line.lineTotal)}
                </span>
              </li>
            ))}
          </ul>

          <dl className="text-body-sm mt-stack">
            <SummaryRow
              label={CHECKOUT.subtotalLabel}
              value={formatMoney(order.subtotal)}
            />
            {compareMoney(order.discountTotal, money(0, order.currencyCode)) >
            0 ? (
              <SummaryRow
                label={CHECKOUT.discountLabel}
                value={`−${formatMoney(order.discountTotal)}`}
              />
            ) : null}
            <SummaryRow
              label={CHECKOUT.deliveryLabel}
              value={
                carried
                  ? CHECKOUT.deliveryFreeValue
                  : formatMoney(order.shippingTotal)
              }
            />
            <SummaryRow
              label={CHECKOUT.placedTotalLabel}
              value={formatMoney(order.total)}
              strong
            />
          </dl>
        </section>

        <section aria-labelledby="checkout-record-h2">
          <h2
            id="checkout-record-h2"
            className="text-eyebrow text-muted border-hairline border-b pb-3 font-mono uppercase"
          >
            {CHECKOUT.placedNumberLabel}
          </h2>

          <p
            id="order-number"
            className={cx(shop.figure, "text-display-3 text-primary mt-stack")}
          >
            {order.orderNumber}
          </p>

          <dl className="text-body-sm mt-stack">
            <SummaryRow label={CHECKOUT.placedEmailLabel} value={order.email} />
          </dl>

          {adminOpen ? (
            <div className="mt-block">
              <Link
                href={`/admin/orders?q=${encodeURIComponent(order.orderNumber)}`}
                className={cx(
                  shop.button,
                  shop.buttonSecondary,
                  shop.buttonBlock,
                )}
              >
                {CHECKOUT.placedAdminLink}
              </Link>
              <p className="text-caption text-muted mt-stack max-w-prose">
                {CHECKOUT.placedAdminNote}
              </p>
            </div>
          ) : null}

          <div className="mt-block">
            <Link
              href={SHOP_PATH}
              className={cx(shop.tap, "text-body-sm text-primary w-fit")}
            >
              <span className={cx(shop.drawLink)}>{STATE.keepShopping}</span>
            </Link>
          </div>
        </section>
      </div>
    </Shell>
  );
}
