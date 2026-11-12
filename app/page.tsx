import { Hero } from "@/components/site/Hero";
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
 * Statically rendered: nothing on it reads a cookie, a header or a database.
 */
export default function HomePage() {
  return (
    <>
      <TopTicker />
      <SiteHeader />
      <main id="main" className="flex-1">
        <Hero />
        <Band />
        <Shop />
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
