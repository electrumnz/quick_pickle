import type { Metadata } from "next";
import Link from "next/link";

import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { PreviewStrip } from "@/components/site/Sections";
import { CHECKOUT, HEADER } from "@/content/site";
import { paymentsAreTest } from "@/lib/shop/payments";

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
export default function CheckoutPage() {
  return (
    <>
      <PreviewStrip />
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
            className="label text-cream hover:text-olive flex min-h-11 items-center text-[1.1rem]"
          >
            <span className="cap-trim">{CHECKOUT.back}</span>
          </Link>
        </div>
      </header>
      <main id="main" className="bg-cream px-gutter flex-1 pt-8 pb-20">
        <div className="max-w-page mx-auto">
          <CheckoutForm testMode={paymentsAreTest()} />
        </div>
      </main>
    </>
  );
}
