"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { Art } from "@/components/brand/Art";
import { ChevronIcon, LockIcon } from "@/components/brand/Icons";
import { useCart } from "@/components/cart/CartProvider";
import { SHIPPING } from "@/content/offer";
import { CHECKOUT, CODES, JAR } from "@/content/site";
import { formatNzd, formatNzdExact } from "@/lib/shop/money";
import { NZ_REGIONS, type FieldErrors } from "@/lib/shop/order";
import { quote } from "@/lib/shop/pricing";

import {
  checkCode,
  submitCheckout,
  type CheckoutState,
  type CodeAnswer,
} from "./actions";

/**
 * The checkout form.
 *
 * One page, one column on a phone, no account, no steps to click through.
 * Things that make a phone checkout quick are all here on purpose:
 *
 *  - every field names itself to the browser (`autocomplete`), so an address
 *    is one tap from autofill rather than forty keystrokes;
 *  - the keyboard matches the field (`inputmode`, `type`), fields are at
 *    least 52px tall and 16px type so iOS does not zoom;
 *  - the order and its total stay in view in a collapsible summary, and the
 *    button states the amount it will take;
 *  - a failed submit keeps everything that was typed, says what to fix next
 *    to the field, and moves focus to the first one.
 *
 * The total shown here is for the buyer's eyes. The server prices the jar
 * again from the offer when the order is placed, and that is what is charged.
 */

const INITIAL: CheckoutState = { status: "idle", errors: {}, values: {} };

type FieldProps = {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly defaultValue?: string;
  readonly type?: string;
  readonly inputMode?: "text" | "email" | "tel" | "numeric";
  readonly autoComplete: string;
  readonly required?: boolean;
  readonly maxLength?: number;
  readonly placeholder?: string;
  readonly className?: string;
};

function Field({
  name,
  label,
  hint,
  error,
  defaultValue,
  type = "text",
  inputMode,
  autoComplete,
  required = false,
  maxLength,
  placeholder,
  className = "",
}: FieldProps) {
  const id = `co-${name}`;
  const describedBy =
    [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="field"
      />
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-navy-muted mt-1.5 text-[0.875rem]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SectionTitle({
  step,
  children,
}: {
  readonly step: number;
  readonly children: string;
}) {
  return (
    <h2 className="varsity flex items-center gap-3 text-[1.75rem] leading-none">
      <span
        aria-hidden="true"
        className="label bg-navy text-cream grid size-8 shrink-0 place-items-center rounded-full text-[1.15rem] leading-none"
      >
        <span className="cap-trim">{step}</span>
      </span>
      {children}
    </h2>
  );
}

export function CheckoutForm({
  mode,
  cancelled = false,
}: {
  /** What paying means right now (lib/shop/payments: checkoutMode). */
  readonly mode: "practice" | "sandbox" | "live";
  /** The buyer came back from the payment page without paying. */
  readonly cancelled?: boolean;
}) {
  const { cart, ready } = useCart();
  const [state, action, pending] = useActionState(submitCheckout, INITIAL);
  const [rural, setRural] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // A promo code. The box holds what was typed; `code` holds the server's
  // answer for it and the jar it was answered for. Only the word is ever
  // sent with the order: the server works out what it is worth again.
  const [typedCode, setTypedCode] = useState("");
  const [code, setCode] = useState<{
    readonly answer: CodeAnswer;
    readonly typed: string;
    readonly jar: string;
  } | null>(null);
  const [checking, startCheck] = useTransition();
  const codeRef = useRef<HTMLInputElement>(null);

  // After a failed submit, take the buyer to the first thing that needs them.
  useEffect(() => {
    if (state.status !== "invalid") return;
    const first = formRef.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"]',
    );
    first?.focus();
  }, [state]);

  if (!ready) {
    // One paint before the stored jar is read. Reserve the space, show nothing.
    return <div className="min-h-[60vh]" aria-busy="true" />;
  }

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto flex max-w-[26rem] flex-col items-center py-12 text-center">
        <Art
          name="lucky-sleeping"
          alt={JAR.emptyAlt}
          sizes="200px"
          className="w-44"
        />
        <h1 className="varsity mt-6 text-[2.25rem] leading-none">
          {CHECKOUT.emptyTitle}
        </h1>
        <p className="text-navy-muted mt-3">{CHECKOUT.emptyBody}</p>
        <Link href="/#shop" className="btn mt-7">
          <span className="cap-trim">{CHECKOUT.emptyCta}</span>
        </Link>
      </div>
    );
  }

  const jar = JSON.stringify(cart.lines);
  const asStored = (text: string) => text.replace(/\s+/g, "").toUpperCase();
  // An answer only counts for the jar it was given for. If the jar has
  // changed since (another tab), it is asked for again.
  const answered = code !== null && code.jar === jar ? code : null;
  const applied =
    answered !== null &&
    answered.answer.ok &&
    asStored(answered.typed) === asStored(typedCode)
      ? answered.answer
      : null;
  const priced = quote(
    cart,
    { rural },
    applied === null
      ? undefined
      : {
          discountCents: applied.discountCents,
          deliveryDiscountCents: applied.deliveryDiscountCents,
        },
  );
  const errors: FieldErrors = state.errors;
  const values = state.values;
  const placeLabel = mode === "practice" ? CHECKOUT.placeTest : CHECKOUT.place;
  const chargedDelivery = priced.deliveryCents - priced.deliveryDiscountCents;
  const savedCents = priced.discountCents + priced.deliveryDiscountCents;

  // What to say under the code box: the server's no for what is typed now,
  // or the refusal that came back with a failed order.
  const codeProblem =
    answered !== null &&
    !answered.answer.ok &&
    asStored(answered.typed) === asStored(typedCode)
      ? answered.answer.reason
      : code === null && typedCode === (values.promoCode ?? "")
        ? (errors.promoCode ?? null)
        : null;
  const codeWaiting = typedCode.trim() !== "" && applied === null;

  const applyCode = () => {
    const typed = typedCode.trim();
    if (typed === "") {
      setCode(null);
      return;
    }
    startCheck(async () => {
      const answer = await checkCode(typed, jar, rural);
      setCode({ answer, typed, jar });
    });
  };
  const removeCode = () => {
    setTypedCode("");
    setCode(null);
  };

  const summary = (
    <div>
      <ul className="flex flex-col gap-3">
        {priced.lines.map((line) => (
          <li
            key={line.sku}
            className="flex items-baseline justify-between gap-4"
          >
            <span className="min-w-0">
              <span className="varsity block text-[1.25rem] leading-tight">
                {line.qty} × {line.pack.name}
              </span>
              <span className="text-navy-muted text-[0.875rem]">
                {line.pack.shots * line.qty} {JAR.shots}
              </span>
            </span>
            <span className="label shrink-0 text-[1.25rem]">
              {formatNzd(line.lineCents)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="border-navy-line mt-4 flex flex-col gap-1.5 border-t-2 pt-4 text-[0.9688rem]">
        <div className="flex justify-between">
          <dt>{CHECKOUT.subtotal}</dt>
          <dd>{formatNzdExact(priced.subtotalCents)}</dd>
        </div>
        {priced.discountCents > 0 && applied !== null ? (
          <div className="flex justify-between" data-testid="discount-line">
            <dt>
              {CODES.codeLine} {applied.code}
            </dt>
            <dd>-{formatNzdExact(priced.discountCents)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between">
          <dt>
            {CHECKOUT.delivery}
            {priced.deliveryDiscountCents > 0 && applied !== null
              ? ` (${CODES.codeLine.toLowerCase()} ${applied.code})`
              : ""}
          </dt>
          <dd>
            {chargedDelivery === 0
              ? CHECKOUT.free
              : formatNzdExact(chargedDelivery)}
          </dd>
        </div>
        {priced.ruralCents > 0 ? (
          <div className="flex justify-between">
            <dt>{CHECKOUT.rural}</dt>
            <dd>{formatNzdExact(priced.ruralCents)}</dd>
          </div>
        ) : null}
        <div className="border-navy mt-2 flex items-baseline justify-between border-t-[3px] pt-3">
          <dt className="label text-[1.35rem]">{CHECKOUT.total}</dt>
          <dd className="label text-[1.9rem] leading-none">
            <span className="text-navy-muted mr-2 text-[1rem]">
              {CHECKOUT.totalNote}
            </span>
            {formatNzdExact(priced.totalCents)}
          </dd>
        </div>
      </dl>
      <p className="mt-3">
        <Link href="/#shop" className="link text-[0.9375rem]">
          {CHECKOUT.edit}
        </Link>
      </p>
    </div>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-start lg:gap-14">
      <div>
        <h1 className="varsity text-[clamp(2.75rem,12vw,4rem)] leading-none">
          {CHECKOUT.title}
        </h1>

        {cancelled && state.status === "idle" ? (
          <div
            role="status"
            className="border-navy bg-paper mt-5 rounded-[14px] border-2 p-4"
          >
            <p className="label text-[1.15rem]">{CHECKOUT.cancelledTitle}</p>
            <p className="mt-1 text-[0.9375rem] leading-snug">
              {CHECKOUT.cancelledBody}
            </p>
          </div>
        ) : null}

        {mode !== "live" ? (
          <div
            role="note"
            className="border-navy bg-olive-wash mt-5 rounded-[14px] border-2 border-dashed p-4"
          >
            <p className="label text-[1.15rem]">
              {mode === "practice" ? CHECKOUT.testTitle : CHECKOUT.sandboxTitle}
            </p>
            <p className="mt-1 text-[0.9375rem] leading-snug">
              {mode === "practice" ? CHECKOUT.testBody : CHECKOUT.sandboxBody}
            </p>
          </div>
        ) : null}

        {/* On a phone the order sits above the form, folded shut. */}
        <details className="card-flat group mt-5 lg:hidden">
          <summary className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
            <span className="label flex items-center gap-2 text-[1.15rem]">
              <span className="group-open:hidden">{CHECKOUT.showSummary}</span>
              <span className="hidden group-open:inline">
                {CHECKOUT.hideSummary}
              </span>
              <ChevronIcon className="size-5 transition-transform duration-200 group-open:rotate-180" />
            </span>
            <span className="label text-[1.5rem] leading-none">
              {formatNzdExact(priced.totalCents)}
            </span>
          </summary>
          <div className="px-4 pb-4">{summary}</div>
        </details>

        <form
          ref={formRef}
          action={action}
          noValidate
          className="mt-8 flex flex-col gap-10"
          onSubmit={(event) => {
            // A code that is typed but not applied would change the total
            // after the button was pressed. Apply it first, show the new
            // total, and let the buyer press the button for that figure.
            if (!codeWaiting) return;
            event.preventDefault();
            applyCode();
            codeRef.current?.focus();
          }}
        >
          <input
            type="hidden"
            name="lines"
            value={JSON.stringify(cart.lines)}
            readOnly
          />
          {/* Honeypot. People never see it; scripts fill it in. */}
          <div aria-hidden="true" className="hidden">
            <label>
              Company
              <input
                type="text"
                name="company"
                tabIndex={-1}
                autoComplete="off"
              />
            </label>
          </div>

          {state.status !== "idle" ? (
            <p
              role="alert"
              className="border-pink-deep bg-blush text-pink-deep rounded-[14px] border-2 p-4 font-semibold"
            >
              {state.status === "invalid" ? CHECKOUT.problem : CHECKOUT.failed}
              {errors.lines ? ` ${errors.lines}.` : ""}
            </p>
          ) : null}

          <section aria-labelledby="co-contact" className="flex flex-col gap-4">
            <div id="co-contact">
              <SectionTitle step={1}>{CHECKOUT.sections.contact}</SectionTitle>
            </div>
            <Field
              name="email"
              label={CHECKOUT.fields.email}
              hint={CHECKOUT.fields.emailHint}
              error={errors.email}
              defaultValue={values.email}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              maxLength={254}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                name="firstName"
                label={CHECKOUT.fields.firstName}
                error={errors.firstName}
                defaultValue={values.firstName}
                autoComplete="given-name"
                required
                maxLength={60}
              />
              <Field
                name="lastName"
                label={CHECKOUT.fields.lastName}
                error={errors.lastName}
                defaultValue={values.lastName}
                autoComplete="family-name"
                required
                maxLength={60}
              />
            </div>
            <Field
              name="phone"
              label={CHECKOUT.fields.phone}
              hint={CHECKOUT.fields.phoneHint}
              error={errors.phone}
              defaultValue={values.phone}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={24}
            />
          </section>

          <section
            aria-labelledby="co-delivery"
            className="flex flex-col gap-4"
          >
            <div id="co-delivery">
              <SectionTitle step={2}>{CHECKOUT.sections.delivery}</SectionTitle>
              <p className="text-navy-muted mt-2 text-[0.9375rem]">
                {CHECKOUT.country}
              </p>
            </div>
            <Field
              name="line1"
              label={CHECKOUT.fields.line1}
              error={errors.line1}
              defaultValue={values.line1}
              autoComplete="address-line1"
              required
              maxLength={120}
            />
            <Field
              name="line2"
              label={CHECKOUT.fields.line2}
              error={errors.line2}
              defaultValue={values.line2}
              autoComplete="address-line2"
              maxLength={120}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                name="suburb"
                label={CHECKOUT.fields.suburb}
                error={errors.suburb}
                defaultValue={values.suburb}
                autoComplete="address-level3"
                maxLength={80}
              />
              <Field
                name="city"
                label={CHECKOUT.fields.city}
                error={errors.city}
                defaultValue={values.city}
                autoComplete="address-level2"
                required
                maxLength={80}
              />
            </div>
            <div className="grid grid-cols-[1fr_8.5rem] gap-4">
              <div>
                <label htmlFor="co-region" className="field-label">
                  {CHECKOUT.fields.region}
                </label>
                <div className="relative">
                  <select
                    id="co-region"
                    name="region"
                    autoComplete="address-level1"
                    required
                    defaultValue={values.region ?? ""}
                    aria-invalid={errors.region ? true : undefined}
                    aria-describedby={
                      errors.region ? "co-region-error" : undefined
                    }
                    className="field pr-10"
                  >
                    <option value="" disabled>
                      {CHECKOUT.fields.regionPlaceholder}
                    </option>
                    {NZ_REGIONS.map((region) => (
                      <option key={region} value={region}>
                        {region}
                      </option>
                    ))}
                  </select>
                  <ChevronIcon className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2" />
                </div>
                {errors.region ? (
                  <p id="co-region-error" className="field-error">
                    {errors.region}
                  </p>
                ) : null}
              </div>
              <Field
                name="postcode"
                label={CHECKOUT.fields.postcode}
                error={errors.postcode}
                defaultValue={values.postcode}
                inputMode="numeric"
                autoComplete="postal-code"
                required
                maxLength={4}
              />
            </div>

            <label className="card-flat flex cursor-pointer items-start gap-3 p-4">
              <input
                type="checkbox"
                name="rural"
                checked={rural}
                onChange={(event) => setRural(event.target.checked)}
                className="accent-navy mt-0.5 size-6 shrink-0"
              />
              <span>
                <span className="block font-semibold">
                  {CHECKOUT.fields.rural}
                </span>
                <span className="text-navy-muted mt-0.5 block text-[0.9375rem] leading-snug">
                  {CHECKOUT.fields.ruralHint}{" "}
                  {formatNzd(SHIPPING.ruralSurchargeCents)}.
                </span>
              </span>
            </label>

            <div>
              <label htmlFor="co-notes" className="field-label">
                {CHECKOUT.fields.notes}
              </label>
              <textarea
                id="co-notes"
                name="notes"
                rows={2}
                maxLength={280}
                placeholder={CHECKOUT.fields.notesPlaceholder}
                defaultValue={values.notes}
                className="field"
              />
            </div>
          </section>

          <section aria-labelledby="co-payment" className="flex flex-col gap-4">
            <div id="co-payment">
              <SectionTitle step={3}>{CHECKOUT.sections.payment}</SectionTitle>
            </div>
            <div className="card-flat bg-paper flex items-start gap-3 p-4">
              <LockIcon className="mt-0.5 size-7 shrink-0" />
              <p className="text-[0.9375rem] leading-snug">
                {mode === "practice"
                  ? CHECKOUT.paymentTest
                  : mode === "sandbox"
                    ? CHECKOUT.paymentSandbox
                    : CHECKOUT.paymentLive}
              </p>
            </div>

            <div>
              <label htmlFor="co-promoCode" className="field-label">
                {CODES.label}
              </label>
              <div className="flex items-stretch gap-2">
                <input
                  ref={codeRef}
                  id="co-promoCode"
                  name="promoCode"
                  value={typedCode}
                  onChange={(event) => setTypedCode(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter here means "apply", not "place the order".
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    applyCode();
                  }}
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={40}
                  placeholder={CODES.placeholder}
                  aria-invalid={codeProblem !== null ? true : undefined}
                  aria-describedby={
                    codeProblem !== null
                      ? "co-promoCode-error"
                      : applied !== null
                        ? "co-promoCode-ok"
                        : undefined
                  }
                  className="field min-w-0 flex-1 uppercase placeholder:normal-case"
                />
                <button
                  type="button"
                  onClick={applyCode}
                  disabled={checking}
                  data-testid="apply-code"
                  className="btn btn-cream shrink-0"
                >
                  <span className="cap-trim">
                    {checking ? CODES.checking : CODES.apply}
                  </span>
                </button>
              </div>
              {codeProblem !== null ? (
                <p id="co-promoCode-error" className="field-error" role="alert">
                  {codeProblem}
                </p>
              ) : applied !== null ? (
                <p
                  id="co-promoCode-ok"
                  role="status"
                  className="mt-1.5 text-[0.9375rem] leading-snug"
                >
                  <strong>
                    {CODES.applied}: {applied.label}.
                  </strong>{" "}
                  {CODES.youSave} {formatNzdExact(savedCents)}.{" "}
                  <button
                    type="button"
                    onClick={removeCode}
                    className="link inline-flex min-h-11 items-center"
                  >
                    {CODES.remove}
                  </button>
                </p>
              ) : null}
            </div>

            <label className="flex cursor-pointer items-start gap-3 py-1">
              <input
                type="checkbox"
                name="joinCrew"
                defaultChecked={values.joinCrew === "on"}
                className="accent-navy mt-0.5 size-6 shrink-0"
              />
              <span className="text-[0.9688rem] leading-snug">
                {CHECKOUT.fields.joinCrew}
              </span>
            </label>

            <button
              type="submit"
              disabled={pending}
              data-testid="place-order"
              className="btn btn-lg btn-block mt-1"
            >
              <span className="cap-trim">
                {pending
                  ? CHECKOUT.placing
                  : `${placeLabel} · ${formatNzdExact(priced.totalCents)}`}
              </span>
            </button>
            <p className="text-navy-muted text-center text-[0.875rem] leading-snug">
              {CHECKOUT.agree}{" "}
              <Link href="/terms" className="underline">
                {CHECKOUT.terms}
              </Link>{" "}
              {CHECKOUT.and}{" "}
              <Link href="/privacy" className="underline">
                {CHECKOUT.privacy}
              </Link>
              .
            </p>
          </section>
        </form>
      </div>

      {/* Wide screens: the order stays beside the form. */}
      <aside
        aria-label={CHECKOUT.sections.summary}
        className="card sticky top-24 hidden p-6 lg:block"
      >
        <h2 className="varsity mb-4 text-[1.75rem] leading-none">
          {CHECKOUT.sections.summary}
        </h2>
        {summary}
      </aside>
    </div>
  );
}
