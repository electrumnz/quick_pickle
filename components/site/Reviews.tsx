import Link from "next/link";

import { StarIcon } from "@/components/brand/Icons";
import { REVIEWS } from "@/content/site";
import type { PublishedReview } from "@/lib/backstage/marketing/reviews";
import type { ShownReviews } from "@/lib/shop/store";
import { formatNzDate } from "@/lib/time";

/**
 * Reviews on the shop: what customers said, once a person has read it and
 * published it in the back end (Marketing, Reviews).
 *
 * With none published nothing here is drawn at all: no empty box, no
 * "be the first", and never a review made up to fill the space. The average
 * is over every published review (lib/backstage/marketing/reviews.ts says
 * why), and the customer's words are shown as they wrote them, as text.
 */

/** "4.5" from 4.5, "5" from 5. */
export const said = (average: number): string =>
  Number.isInteger(average) ? String(average) : average.toFixed(1);

/**
 * Five stars, filled as far as the rating goes. Decoration: the number is
 * always said in words beside them.
 */
export function Stars({
  value,
  className = "size-5",
}: {
  readonly value: number;
  readonly className?: string;
}) {
  const share = Math.max(0, Math.min(1, value / 5));
  const row = (filled: boolean) =>
    [0, 1, 2, 3, 4].map((index) => (
      <StarIcon
        key={index}
        filled={filled}
        className={`${className} text-navy shrink-0`}
      />
    ));
  return (
    <span aria-hidden="true" className="relative inline-flex">
      <span className="flex">{row(false)}</span>
      <span
        className="absolute inset-y-0 left-0 flex overflow-hidden"
        style={{ width: `${String(share * 100)}%` }}
      >
        {row(true)}
      </span>
    </span>
  );
}

/**
 * The rating in one line, for beside the packs: stars and the words, and a
 * link down to the reviews. Nothing with no reviews.
 */
export function RatingLine({ shown }: { readonly shown: ShownReviews }) {
  if (shown.count === 0 || shown.average === null) return null;
  return (
    <a
      href="#reviews"
      className="hover:text-pink-deep mt-3 inline-flex min-h-11 items-center gap-2.5 font-semibold underline-offset-4 hover:underline"
    >
      <Stars value={shown.average} />
      <span>{REVIEWS.summary(said(shown.average), shown.count)}</span>
    </a>
  );
}

/** One review, as its customer wrote it. */
export function ReviewCard({ review }: { readonly review: PublishedReview }) {
  return (
    <li className="card-flat flex h-full flex-col p-5">
      <p className="flex items-center gap-2">
        <Stars value={review.rating} className="size-[1.125rem]" />
        <span className="sr-only">{REVIEWS.stars(review.rating)}</span>
      </p>
      <blockquote className="mt-3 flex-1 leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">
        {review.body}
      </blockquote>
      <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.9375rem]">
        <span className="font-semibold [overflow-wrap:anywhere]">
          {review.displayName}
        </span>
        {review.verified ? (
          <span className="label bg-navy text-cream rounded-full px-2.5 pt-1 pb-0.5 text-[0.9375rem]">
            {REVIEWS.verified}
          </span>
        ) : null}
        <span className="text-navy-muted">
          {formatNzDate(review.publishedAt)}
        </span>
      </p>
    </li>
  );
}

/** The section on the page: the average, the newest few, and the way in. */
export function ReviewsSection({ shown }: { readonly shown: ShownReviews }) {
  if (shown.count === 0 || shown.average === null) return null;
  const more = shown.count > shown.reviews.length;
  return (
    <section
      id="reviews"
      aria-labelledby="reviews-title"
      className="bg-cream scroll-mt-16 py-16 md:py-24"
    >
      <div className="max-w-page-gutters px-gutter mx-auto">
        <div
          data-reveal
          className="md:flex md:items-end md:justify-between md:gap-10"
        >
          <div>
            <p className="label text-pink-deep text-[1.2rem]">
              {REVIEWS.eyebrow}
            </p>
            <h2
              id="reviews-title"
              className="varsity mt-2 text-[clamp(2.6rem,13vw,4.75rem)] leading-[0.95]"
            >
              {REVIEWS.title}
            </h2>
          </div>
          <p className="mt-5 flex items-center gap-3 md:mt-0">
            <span className="varsity text-[3rem] leading-none">
              {said(shown.average)}
            </span>
            <span className="flex flex-col gap-1">
              <Stars value={shown.average} className="size-6" />
              <span className="text-[0.9375rem]">
                {REVIEWS.summary(said(shown.average), shown.count)}
              </span>
            </span>
          </p>
        </div>

        <ul className="mt-9 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {shown.reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </ul>

        <p className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link href="/review" className="btn">
            <span className="cap-trim">{REVIEWS.write}</span>
          </Link>
          {more ? (
            <Link href="/reviews" className="link font-semibold">
              {REVIEWS.readAll(shown.count)}
            </Link>
          ) : null}
        </p>
      </div>
    </section>
  );
}
