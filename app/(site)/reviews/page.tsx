import type { Metadata } from "next";
import Link from "next/link";

import { ReviewCard, said, Stars } from "@/components/site/Reviews";
import { SiteFooter } from "@/components/site/Sections";
import { SiteHeader } from "@/components/site/SiteHeader";
import { REVIEWS } from "@/content/site";
import { reviewsForPage } from "@/lib/shop/reviews-now";

export const metadata: Metadata = {
  title: REVIEWS.pageTitle,
  description: REVIEWS.pageLead,
};

/** Every review the shop can show, the newest hundred at most. */
const SHOWN = 100;

/**
 * Every published review, newest first, with the average over all of them.
 * Built once and kept like the shop's page: publishing or taking down a
 * review throws the kept copy away.
 */
export default async function ReviewsPage() {
  const shown = await reviewsForPage(SHOWN);
  return (
    <>
      <SiteHeader minimal />
      <main id="main" className="bg-cream flex-1 pt-10 pb-20">
        <div className="max-w-page-gutters px-gutter mx-auto">
          <h1 className="varsity text-[clamp(2.75rem,12vw,4.5rem)] leading-[0.95]">
            {REVIEWS.pageTitle}
          </h1>
          {shown.average === null ? (
            <p className="mt-4 max-w-[36rem] text-[1.125rem] leading-relaxed">
              {REVIEWS.none}
            </p>
          ) : (
            <>
              <p className="text-navy-muted mt-4 max-w-[36rem] text-[1.125rem] leading-relaxed">
                {REVIEWS.pageLead}
              </p>
              <p className="mt-5 flex items-center gap-3">
                <Stars value={shown.average} className="size-6" />
                <span className="font-semibold">
                  {REVIEWS.summary(said(shown.average), shown.count)}
                </span>
              </p>
              <ul className="mt-9 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {shown.reviews.map((review) => (
                  <ReviewCard key={review.id} review={review} />
                ))}
              </ul>
            </>
          )}
          <p className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href="/review" className="btn">
              <span className="cap-trim">{REVIEWS.write}</span>
            </Link>
            <Link href="/" className="link font-semibold">
              {REVIEWS.form.back}
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
