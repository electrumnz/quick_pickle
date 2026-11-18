import type { Metadata } from "next";
import Link from "next/link";

import { ReviewForm } from "@/components/site/ReviewForm";
import { SiteFooter } from "@/components/site/Sections";
import { SiteHeader } from "@/components/site/SiteHeader";
import { REVIEWS } from "@/content/site";

export const metadata: Metadata = {
  title: REVIEWS.form.metaTitle,
  description: REVIEWS.form.lead,
  // A form is nobody's landing page.
  robots: { index: false, follow: true },
};

/**
 * Write a review. What is sent lands in the back end (Marketing, Reviews)
 * waiting for a person, and is shown on the shop only once somebody has
 * read it and published it.
 */
export default function WriteReviewPage() {
  return (
    <>
      <SiteHeader minimal />
      <main id="main" className="bg-cream px-gutter flex-1 pt-10 pb-20">
        <div className="mx-auto max-w-[36rem]">
          <h1 className="varsity text-[clamp(2.75rem,12vw,4.5rem)] leading-[0.95]">
            {REVIEWS.form.title}
          </h1>
          <p className="text-navy-muted mt-4 text-[1.125rem] leading-relaxed">
            {REVIEWS.form.lead}
          </p>
          <ReviewForm />
          <p className="border-navy mt-14 border-t-[3px] pt-6">
            <Link href="/" className="link">
              {REVIEWS.form.back}
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
