import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { Art } from "@/components/brand/Art";
import { CheckAgain } from "@/components/checkout/CheckAgain";
import { ClearJar } from "@/components/checkout/ClearJar";
import { SiteFooter } from "@/components/site/Sections";
import { SiteHeader } from "@/components/site/SiteHeader";
import { CHECKOUT, CODES, JAR, SPECIAL, THANKS } from "@/content/site";
import { mailConnection } from "@/lib/mail";
import { formatNzdExact } from "@/lib/shop/money";
import { checkoutMode } from "@/lib/shop/payments";
import { settleOnReturn } from "@/lib/shop/payments/settle";
import { parseReceipt, RECEIPT_COOKIE } from "@/lib/shop/receipt";

export const metadata: Metadata = {
  title: THANKS.metaTitle,
  robots: { index: false, follow: false },
};

/** A pickle for every colour in the palette. Decoration for the big moment. */
const CONFETTI = [
  { left: "6%", delay: "0ms", drift: "24px", spin: "420deg", tone: "bg-olive" },
  {
    left: "18%",
    delay: "180ms",
    drift: "-18px",
    spin: "-560deg",
    tone: "bg-navy",
  },
  {
    left: "31%",
    delay: "60ms",
    drift: "30px",
    spin: "640deg",
    tone: "bg-cream",
  },
  {
    left: "44%",
    delay: "260ms",
    drift: "-26px",
    spin: "-380deg",
    tone: "bg-olive",
  },
  {
    left: "57%",
    delay: "120ms",
    drift: "16px",
    spin: "520deg",
    tone: "bg-navy",
  },
  {
    left: "69%",
    delay: "320ms",
    drift: "-30px",
    spin: "-620deg",
    tone: "bg-cream",
  },
  {
    left: "81%",
    delay: "40ms",
    drift: "22px",
    spin: "460deg",
    tone: "bg-olive",
  },
  {
    left: "92%",
    delay: "220ms",
    drift: "-14px",
    spin: "-500deg",
    tone: "bg-navy",
  },
] as const;

/**
 * "Order's in."
 *
 * Reads the receipt cookie the checkout set (lib/shop/receipt.ts) and shows
 * the order back. With no receipt on this device it says so plainly rather
 * than showing an empty confirmation.
 *
 * It says a receipt is on its way only when one is: for a real, paid order
 * placed while order emails were really being sent. Otherwise it says
 * nothing about email at all.
 */
export default async function ThanksPage() {
  const receipt = parseReceipt((await cookies()).get(RECEIPT_COOKIE)?.value);

  if (receipt === null) {
    return (
      <>
        <SiteHeader minimal />
        <main id="main" className="bg-cream px-gutter flex-1 py-16">
          <div className="mx-auto flex max-w-[28rem] flex-col items-center text-center">
            <Art
              name="lucky-sleeping"
              alt={JAR.emptyAlt}
              sizes="200px"
              className="w-44"
            />
            <h1 className="varsity mt-6 text-[2.25rem] leading-none">
              {THANKS.noneTitle}
            </h1>
            <p className="text-navy-muted mt-3">
              {THANKS.noneBody}
              {
                // Only said while a receipt really would have been sent.
                mailConnection().delivers ? ` ${THANKS.noneCheckEmail}` : null
              }
            </p>
            <Link href="/" className="btn mt-7">
              <span className="cap-trim">{THANKS.home}</span>
            </Link>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  // The buyer was sent away to pay. Find out how that went before saying
  // anything: nothing is celebrated on the strength of a cookie.
  const settlement = receipt.pending
    ? await settleOnReturn(receipt.number)
    : null;
  const settled = settlement?.state ?? null;
  const payAt = settlement?.payAt;

  // Back on the site with the payment page still open and nothing paid: say
  // so, and show the way back to it. (Pressing "back" on Stripe's page goes
  // to the checkout instead; this is for a buyer who came here by hand.)
  if (settled === "awaiting" && payAt !== undefined) {
    return (
      <>
        <CheckAgain />
        <SiteHeader minimal />
        <main id="main" className="bg-cream px-gutter flex-1 py-16">
          <div className="mx-auto flex max-w-[28rem] flex-col items-center text-center">
            <Art name="lucky-flying" alt="" sizes="200px" className="w-44" />
            <h1 className="varsity mt-6 text-[2.25rem] leading-none">
              {THANKS.unpaidTitle.join(" ")}
            </h1>
            <p className="text-navy-muted mt-3" role="status">
              {THANKS.unpaidBody}
            </p>
            <p className="label mt-5 text-[1.1rem]">
              {THANKS.numberLabel}{" "}
              <span data-testid="order-number">{receipt.number}</span>
            </p>
            <a href={payAt} className="btn mt-7" data-testid="finish-paying">
              <span className="cap-trim">{THANKS.unpaidCta}</span>
            </a>
            <Link href="/checkout" className="link mt-4">
              {THANKS.unpaidChange}
            </Link>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  if (settled === "awaiting" || settled === "unknown") {
    return (
      <>
        <CheckAgain />
        <SiteHeader minimal />
        <main id="main" className="bg-cream px-gutter flex-1 py-16">
          <div className="mx-auto flex max-w-[28rem] flex-col items-center text-center">
            <Art name="lucky-flying" alt="" sizes="200px" className="w-44" />
            <h1 className="varsity mt-6 text-[2.25rem] leading-none">
              {THANKS.awaitingTitle.join(" ")}
            </h1>
            <p className="text-navy-muted mt-3" role="status">
              {THANKS.awaitingBody}
            </p>
            <p className="label mt-5 text-[1.1rem]">
              {THANKS.numberLabel}{" "}
              <span data-testid="order-number">{receipt.number}</span>
            </p>
            <Link href="/order/thanks" prefetch={false} className="btn mt-7">
              <span className="cap-trim">{THANKS.awaitingAgain}</span>
            </Link>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  if (settled === "closed") {
    return (
      <>
        <SiteHeader minimal />
        <main id="main" className="bg-cream px-gutter flex-1 py-16">
          <div className="mx-auto flex max-w-[28rem] flex-col items-center text-center">
            <Art
              name="lucky-sleeping"
              alt={JAR.emptyAlt}
              sizes="200px"
              className="w-44"
            />
            <h1 className="varsity mt-6 text-[2.25rem] leading-none">
              {THANKS.closedTitle.join(" ")}
            </h1>
            <p className="text-navy-muted mt-3">{THANKS.closedBody}</p>
            <Link href="/checkout" className="btn mt-7">
              <span className="cap-trim">{THANKS.closedCta}</span>
            </Link>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  // Paid (or never needed a payment page). A payment made with the
  // processor in its own test mode says so, like any other test order.
  const sandbox = settled !== null && checkoutMode() === "sandbox";
  const note =
    settled === "review"
      ? THANKS.reviewNote
      : receipt.test
        ? THANKS.testNote
        : sandbox
          ? THANKS.sandboxNote
          : null;
  const isTest = receipt.test || sandbox;

  return (
    <>
      <ClearJar />
      <SiteHeader minimal />
      <main id="main" className="flex-1">
        <section className="on-pink bg-pink px-gutter relative overflow-hidden pt-10 pb-14 text-center">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden"
          >
            {CONFETTI.map((piece) => (
              <span
                key={piece.left}
                className={`border-navy absolute top-0 h-7 w-3 rounded-full border-2 ${piece.tone}`}
                style={
                  {
                    left: piece.left,
                    animation: `qp-confetti 2.6s cubic-bezier(0.3, 0.6, 0.6, 1) ${piece.delay} both`,
                    "--drift": piece.drift,
                    "--spin": piece.spin,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>

          <div className="relative mx-auto max-w-[34rem]">
            <Art
              name="lucky-celebrate"
              alt={THANKS.alt}
              sizes="(min-width: 768px) 280px, 56vw"
              className="animate-rise mx-auto w-[56%] max-w-[17rem]"
              eager
            />
            <h1 className="display text-cream animate-rise mt-4 text-[min(27vw,8rem)] leading-[0.88] [animation-delay:80ms]">
              {THANKS.title.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </h1>
            <p className="label text-navy mt-4 text-[1.5rem] leading-tight">
              {THANKS.lead}{" "}
              {receipt.firstName
                ? `${THANKS.cheers}, ${receipt.firstName}.`
                : ""}
            </p>
          </div>
        </section>

        <section className="bg-cream px-gutter pt-10 pb-16">
          <div className="mx-auto max-w-[34rem]">
            {note !== null ? (
              <p
                role="note"
                className="border-navy bg-olive-wash mb-6 rounded-[14px] border-2 border-dashed p-4 text-[0.9375rem] leading-snug"
              >
                {note}
              </p>
            ) : null}

            <div className="card p-5 md:p-6">
              <p className="label text-pink-deep text-[1.1rem]">
                {THANKS.numberLabel}
              </p>
              <p
                className="varsity mt-1 text-[2.25rem] leading-none tracking-[0.06em]"
                data-testid="order-number"
              >
                {receipt.number}
              </p>

              <h2 className="label mt-6 text-[1.2rem]">{THANKS.summary}</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {receipt.lines.map((line) => (
                  <li
                    key={line.name}
                    className="flex items-baseline justify-between gap-4"
                  >
                    <span>
                      {line.qty} × {line.name}{" "}
                      <span className="text-navy-muted text-[0.9375rem]">
                        ({line.shots * line.qty} {JAR.shots})
                      </span>
                    </span>
                    <span>{formatNzdExact(line.lineCents)}</span>
                  </li>
                ))}
              </ul>
              <dl className="border-navy-line mt-4 flex flex-col gap-1.5 border-t-2 pt-4 text-[0.9688rem]">
                <div className="flex justify-between">
                  <dt>{CHECKOUT.subtotal}</dt>
                  <dd>{formatNzdExact(receipt.subtotalCents)}</dd>
                </div>
                {receipt.promoCode !== undefined ? (
                  <div className="flex justify-between">
                    <dt>
                      {receipt.special !== undefined
                        ? `${SPECIAL.tag}: ${receipt.special}`
                        : `${CODES.codeLine} ${receipt.promoCode}`}
                    </dt>
                    <dd>
                      {(receipt.discountCents ?? 0) > 0
                        ? `-${formatNzdExact(receipt.discountCents ?? 0)}`
                        : CODES.applied}
                    </dd>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <dt>{CHECKOUT.delivery}</dt>
                  <dd>
                    {receipt.shippingCents === 0
                      ? CHECKOUT.free
                      : formatNzdExact(receipt.shippingCents)}
                  </dd>
                </div>
                <div className="border-navy mt-2 flex items-baseline justify-between border-t-[3px] pt-3">
                  <dt className="label text-[1.35rem]">{CHECKOUT.total}</dt>
                  <dd className="label text-[1.75rem] leading-none">
                    {formatNzdExact(receipt.totalCents)}
                  </dd>
                </div>
              </dl>

              <h2 className="label mt-6 text-[1.2rem]">{THANKS.deliverTo}</h2>
              <p className="mt-1">
                {receipt.city}, {receipt.region} {receipt.postcode}
              </p>
            </div>

            {isTest || settled === "review" ? null : receipt.emails === true ? (
              // Only when one really is being sent: the flag was set on the
              // server, from how email was set up as the order was placed.
              <p className="mt-6 leading-relaxed" data-testid="receipt-note">
                {THANKS.emailNote} <strong>{receipt.email}</strong>.{" "}
                {receipt.mode === "preorder"
                  ? THANKS.preorderNote
                  : THANKS.liveNote}
              </p>
            ) : (
              <p className="mt-6 leading-relaxed" data-testid="keep-number">
                {THANKS.keepNumber}
                {receipt.mode === "preorder" ? ` ${THANKS.preorderOnly}` : null}
              </p>
            )}

            <Link href="/" className="btn mt-8">
              <span className="cap-trim">{THANKS.home}</span>
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
