import { Hero, type HeroWords } from "@/components/site/Hero";
import {
  Band,
  Crew,
  Faq,
  FinalCta,
  MeetLucky,
  ReelsSection,
  Ritual,
  Shop,
  SiteFooter,
  TopTicker,
  Truths,
} from "@/components/site/Sections";
import { SiteHeader } from "@/components/site/SiteHeader";
import { StickyBuyBar } from "@/components/site/StickyBuyBar";
import { offerForPage } from "@/lib/shop/offer-now";
import { specialForPage } from "@/lib/shop/special-now";
import { topLineForPage } from "@/lib/shop/top-line-now";

/**
 * Quick Pickle, the one page.
 *
 * Top to bottom it is a single argument for one button:
 *
 *   hero       what it is, the line, the button
 *   shop       pick a pack, put it in the jar
 *   truths     the three things we can stand behind
 *   ritual     where it fits in a game day
 *   reels      the clips, once there are clips (content/media.ts)
 *   lucky      who is asking
 *   crew       not ready to buy? stay close
 *   faq        the fair questions
 *   final      the button again
 *
 * The shop comes second, straight under the hero, because the visitor who
 * arrived ready to buy should not have to read their way to the till. The
 * rest of the page is for everybody else, and the sticky bar keeps the
 * button with them the whole way down.
 *
 * A landing page (/for/<slug>) is this same page with other words in the
 * hero: `words`. Everything under the hero is the shop's own and is the same
 * for everybody. `page` is the page's short name, which the visit counter
 * and an order read off <main> to say which page was shown.
 */
export async function ShopPage({
  words,
  page = "home",
  preview = false,
  line,
}: {
  readonly words?: HeroWords;
  readonly page?: string;
  /** A member of staff looking at a draft. The visit counter stays quiet. */
  readonly preview?: boolean;
  /**
   * Words to run across the top in place of what is published: a member of
   * staff looking at a draft of the line. Never set on a public page.
   */
  readonly line?: readonly string[];
}) {
  // What is on sale, for how much. Asked for once and handed down, so every
  // price and every word about delivery on the page is from one offer (the
  // jar's own copy comes from the layout, which asks the same place).
  const offer = await offerForPage();
  // A special that is on is said twice: first in the line across the top,
  // and again where the packs are picked. Usually there is none.
  const special = await specialForPage();
  // The line across the top is the site's own unless the back end has
  // published another (null is the site's own).
  const topLine = line ?? (await topLineForPage());
  return (
    <>
      <TopTicker special={special} lines={topLine} />
      <SiteHeader />
      <main
        id="main"
        data-page={page}
        data-preview={preview ? "" : undefined}
        className="flex-1"
      >
        <Hero offer={offer} words={words} />
        <Band />
        <Shop offer={offer} special={special} />
        <Truths />
        <Ritual />
        <ReelsSection />
        <MeetLucky />
        <Crew />
        <Faq offer={offer} />
        <FinalCta offer={offer} />
      </main>
      <SiteFooter />
      {/* Reserves the sticky bar's height on phones so it never covers the
          last line of the footer. With the shop shut there is no bar. */}
      {offer.open ? (
        <div aria-hidden="true" className="bg-navy h-[76px] md:hidden" />
      ) : null}
      <StickyBuyBar />
    </>
  );
}
