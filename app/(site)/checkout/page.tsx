import type { Metadata } from "next";
import Link from "next/link";

import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { FreshOffer } from "@/components/checkout/FreshOffer";
import { CHECKOUT, HEADER } from "@/content/site";
import { mailConnection } from "@/lib/mail";
import { forPage } from "@/lib/shop/offer";
import { offerForPage } from "@/lib/shop/offer-now";
import { checkoutMode } from "@/lib/shop/payments";

export const metadata: Metadata = {
  title: CHECKOUT.metaTitle,
  // A checkout is nobody's landing page.
  robots: { index: false, follow: false },
};

/**
 * Checkout: ours, start to finish.
 *
 * The chrome is stripped to a wordmark and a way back. No ticker, no nav, no
 * jar button: the only thing to do on this page is finish.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string | string[] }>;
}) {
  // Back from the payment page without paying.
  const cancelled = (await searchParams).payment === "cancelled";
  // This page is drawn for each visit, so this is the offer as it stands.
  const offer = forPage(await offerForPage());
  return (
    <>
      <FreshOffer offer={offer} />
      <header className="on-navy bg-navy border-navy-deep border-b-[3px]">
        <div className="max-w-page px-gutter mx-auto flex h-14 items-center justify-between gap-4 md:h-16">
          <Link
            href="/"
            aria-label={HEADER.home}
            className="varsity text-cream flex min-h-11 items-center text-[1.55rem] leading-none whitespace-nowrap [text-shadow:2px_2px_0_var(--color-pink)] md:text-[1.8rem]"
          >
            <span className="cap-trim">Quick Pickle</span>
          </Link>
          <Link
            href="/#shop"
            className="label text-cream flex min-h-11 items-center text-[1.1rem] decoration-2 underline-offset-4 hover:underline"
          >
            <span className="cap-trim">{CHECKOUT.back}</span>
          </Link>
        </div>
      </header>
      <main id="main" className="bg-cream px-gutter flex-1 pt-8 pb-20">
        <div className="max-w-page mx-auto">
          <CheckoutForm
            mode={checkoutMode()}
            cancelled={cancelled}
            // A receipt is only promised where one will really be sent.
            emails={mailConnection().delivers}
          />
        </div>
      </main>
    </>
  );
}
