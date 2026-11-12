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
import { specialForPage } from "@/lib/shop/special-now";

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
}: {
  readonly words?: HeroWords;
  readonly page?: string;
  /** A member of staff looking at a draft. The visit counter stays quiet. */
  readonly preview?: boolean;
}) {
  // A special that is on is said twice: first in the line across the top,
  // and again where the packs are picked. Usually there is none.
  const special = await specialForPage();
  return (
    <>
      <TopTicker special={special} />
      <SiteHeader />
      <main
        id="main"
        data-page={page}
        data-preview={preview ? "" : undefined}
        className="flex-1"
      >
        <Hero words={words} />
        <Band />
        <Shop special={special} />
        <Truths />
        <Ritual />
        <ReelsSection />
        <MeetLucky />
        <Crew />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
      {/* Reserves the sticky bar's height on phones so it never covers the
          last line of the footer. */}
      <div aria-hidden="true" className="bg-navy h-[76px] md:hidden" />
      <StickyBuyBar />
    </>
  );
}
