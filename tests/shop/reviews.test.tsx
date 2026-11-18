import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RatingLine,
  ReviewsSection,
  said,
  Stars,
} from "@/components/site/Reviews";
import { REVIEWS } from "@/content/site";
import { checkOutgoing } from "@/lib/backstage/core/copy";
import type { ShownReviews } from "@/lib/shop/store";
import {
  forgetReviews,
  NO_REVIEWS,
  reviewsForPage,
} from "@/lib/shop/reviews-now";

/**
 * Reviews on the shop's side: what is drawn from what was published, that
 * nothing is drawn with none, and how a page that is built once and kept
 * finds out which reviews to show.
 */

const store = vi.hoisted(() => ({
  currentReviews: undefined as
    undefined | ((limit?: number) => Promise<ShownReviews> | ShownReviews),
  asked: [] as (number | undefined)[],
}));
vi.mock("@/lib/shop/store", () => ({
  getStore: () => ({
    ...(store.currentReviews === undefined
      ? {}
      : {
          currentReviews: async (limit?: number) => {
            store.asked.push(limit);
            return store.currentReviews?.(limit) ?? NO_REVIEWS;
          },
        }),
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  store.currentReviews = undefined;
  store.asked = [];
  forgetReviews();
});

const PUBLISHED = new Date("2026-11-17T22:00:00Z");

const TWO: ShownReviews = {
  reviews: [
    {
      id: "rev_aaaaaaaaaaaaaaaaaaaa",
      rating: 5,
      body: "Sour, salty and gone in one gulp.\nBought <b>two</b> more.",
      displayName: "Priya, Auckland",
      verified: true,
      publishedAt: PUBLISHED,
    },
    {
      id: "rev_bbbbbbbbbbbbbbbbbbbb",
      rating: 4,
      body: "Pulled a face. Had another.",
      displayName: "Mere",
      verified: false,
      publishedAt: PUBLISHED,
    },
  ],
  count: 2,
  average: 4.5,
};

describe("the reviews on the shop", () => {
  it("draws nothing at all with none published", () => {
    expect(renderToStaticMarkup(<ReviewsSection shown={NO_REVIEWS} />)).toBe(
      "",
    );
    expect(renderToStaticMarkup(<RatingLine shown={NO_REVIEWS} />)).toBe("");
  });

  it("shows the average over all of them, and each review as it was written", () => {
    const html = renderToStaticMarkup(<ReviewsSection shown={TWO} />);
    expect(html).toContain('id="reviews"');
    expect(html).toContain(REVIEWS.title);
    expect(html).toContain(REVIEWS.summary("4.5", 2));
    for (const review of TWO.reviews) {
      expect(html).toContain(review.displayName);
      expect(html).toContain(REVIEWS.stars(review.rating));
    }
    // A customer's words are text: nothing they typed is ever markup.
    expect(html).toContain("Bought &lt;b&gt;two&lt;/b&gt; more.");
    expect(html).not.toContain("<b>two</b>");
    // Only a review tied to a real order says it was bought.
    expect(html.split(REVIEWS.verified)).toHaveLength(2);
    // The way to write one, and no "read all" while all are on the page.
    expect(html).toContain('href="/review"');
    expect(html).not.toContain('href="/reviews"');
  });

  it("points to the rest when there are more than it shows", () => {
    const more = { ...TWO, count: 9 };
    const html = renderToStaticMarkup(<ReviewsSection shown={more} />);
    expect(html).toContain('href="/reviews"');
    expect(html).toContain(REVIEWS.readAll(9));
  });

  it("says the rating in one line beside the packs, linking down to them", () => {
    const html = renderToStaticMarkup(<RatingLine shown={TWO} />);
    expect(html).toContain('href="#reviews"');
    expect(html).toContain(REVIEWS.summary("4.5", 2));
  });

  it("fills the stars as far as the rating goes, and says it in words", () => {
    expect(said(4.5)).toBe("4.5");
    expect(said(5)).toBe("5");
    expect(said(4.25)).toBe("4.3");
    const html = renderToStaticMarkup(<Stars value={4.5} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("width:90%");
  });

  it("goes out with words of ours that pass the copy rules", () => {
    const form = REVIEWS.form;
    expect(
      checkOutgoing({
        eyebrow: REVIEWS.eyebrow,
        title: REVIEWS.title,
        summary: REVIEWS.summary("4.5", 12),
        one: REVIEWS.summary("5", 1),
        verified: REVIEWS.verified,
        write: REVIEWS.write,
        readAll: REVIEWS.readAll(12),
        pageTitle: REVIEWS.pageTitle,
        pageLead: REVIEWS.pageLead,
        none: REVIEWS.none,
        formTitle: form.title,
        lead: form.lead,
        nameHint: form.nameHint,
        bought: form.bought,
        boughtHint: form.boughtHint,
        thanks: form.thanks,
        ...form.problems,
      }),
    ).toEqual([]);
  });
});

describe("the reviews a page is built with", () => {
  it("are whatever is published when the page is built", async () => {
    store.currentReviews = () => TWO;
    expect(await reviewsForPage()).toEqual(TWO);
    expect(await reviewsForPage(100)).toEqual(TWO);
    expect(store.asked).toEqual([6, 100]);
  });

  it("are never looked up while the site itself is being built", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    store.currentReviews = () => TWO;
    expect(await reviewsForPage()).toEqual(NO_REVIEWS);
    expect(store.asked).toEqual([]);
  });

  it("are none when they cannot be read and never have been", async () => {
    store.currentReviews = () => Promise.reject(new Error("no database"));
    expect(await reviewsForPage()).toEqual(NO_REVIEWS);
    // A store with no reviews at all.
    store.currentReviews = undefined;
    expect(await reviewsForPage()).toEqual(NO_REVIEWS);
  });

  it("are the last ones read when the database blinks", async () => {
    store.currentReviews = () => TWO;
    await reviewsForPage();
    store.currentReviews = () => Promise.reject(new Error("no database"));
    expect(await reviewsForPage()).toEqual(TWO);
    // One somebody took down does not come back because of a blink.
    store.currentReviews = () => NO_REVIEWS;
    await reviewsForPage();
    store.currentReviews = () => Promise.reject(new Error("no database"));
    expect(await reviewsForPage()).toEqual(NO_REVIEWS);
  });
});
