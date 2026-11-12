import { Art } from "@/components/brand/Art";
import { ArrowIcon, CheckIcon } from "@/components/brand/Icons";
import { LuckyRun } from "@/components/brand/Vector";
import { LoopVideo } from "@/components/ui/LoopVideo";
import { MEDIA } from "@/content/media";
import { HERO, SHOP } from "@/content/site";
import { formatNzd } from "@/lib/shop/money";
import type { OfferOnPage } from "@/lib/shop/offer";

/**
 * The hero.
 *
 * Built for a phone held in one hand. The first screen is a poster: what it
 * is (the chip), the line, set as big as the screen is wide, Lucky running
 * under it, and the button. Everything else can wait for a scroll.
 *
 * The ground is hot pink, where only large type passes contrast, so the one
 * sentence of body copy sits on a cream card below the button. That
 * constraint is also the look: pink poster, cream ticket, navy button.
 *
 * Lucky is Ashleigh's running drawing from concept page 2, inline from her
 * vector paths. He is the largest thing on the first screen, so being in the
 * document (no image request) is what makes the page paint fast, and being
 * vector is what lets his burst lines, speed lines and dust actually move.
 * If a hero video is supplied (content/media.ts) it takes his place.
 */
export type HeroWords = {
  readonly eyebrow: string;
  /** The headline, a line of it to a line. */
  readonly headline: string;
  readonly lead: string;
};

/**
 * How big a landing page's headline can be set and still fit.
 *
 * The standard headline is two lines of 13 letters on a phone, at a size
 * that spans the screen, and three lines of up to 10 in the wide layout's
 * narrower column. A longer line gets a smaller size by the same ratio, so
 * the line still fits and never runs off the edge. Returned as lengths the
 * heading's own classes read through two custom properties.
 */
function fitFor(lines: readonly string[]): React.CSSProperties {
  const longest = Math.max(...lines.map((line) => line.length), 1);
  return {
    "--hero-phone": `${(291 / Math.max(13, longest)).toFixed(2)}vw`,
    "--hero-wide": `${(104 / Math.max(10, longest)).toFixed(2)}vw`,
  } as React.CSSProperties;
}

export function Hero({
  offer,
  words,
}: {
  /** What is on sale: the button's word and the "packs from" price. */
  readonly offer: OfferOnPage;
  readonly words?: HeroWords;
}) {
  const from = offer.packs[0];
  // Shut for now: the button leads to the Pickle Crew, not to a buy box
  // that cannot be used.
  const cta = offer.open
    ? { label: HERO.cta(offer), href: "#shop" }
    : { label: SHOP.closedCta, href: "#crew" };
  const lines =
    words === undefined
      ? null
      : words.headline.split("\n").filter((line) => line !== "");

  return (
    <section
      id="top"
      className="on-pink bg-pink relative isolate overflow-hidden"
    >
      {/* Speed lines in the ground, like the dust behind Lucky. Decoration. */}
      <div
        aria-hidden="true"
        className="pattern-stripes pointer-events-none absolute inset-0 -z-10 opacity-[0.055]"
      />

      <div className="max-w-page px-gutter mx-auto pt-5 pb-10 md:grid md:grid-cols-[1fr_1fr] md:items-center md:gap-10 md:pt-14 md:pb-20 lg:gap-16">
        <div className="relative z-10">
          <p className="label bg-navy text-cream animate-rise inline-flex rounded-full px-4 py-2 text-[1.15rem] leading-none md:text-[1.3rem]">
            <span className="cap-trim">{words?.eyebrow ?? HERO.eyebrow}</span>
          </p>

          {/* Two lines on a phone, sized to span the screen; three on a wide
              screen, where the column is narrower than the viewport. */}
          {lines !== null ? (
            // A landing page's own headline: its lines as written, at the
            // biggest size its longest line fits.
            <h1
              style={fitFor(lines)}
              className="display text-cream animate-rise mt-4 text-[min(var(--hero-phone),7rem)] leading-[0.9] [animation-delay:70ms] md:text-[clamp(3rem,var(--hero-wide),10.5rem)]"
            >
              {lines.map((line, index) => (
                <span key={`${String(index)}-${line}`}>
                  {index === 0 ? null : <br />}
                  {line}
                </span>
              ))}
            </h1>
          ) : (
            <h1 className="display text-cream animate-rise mt-4 text-[min(22.4vw,7rem)] leading-[0.9] [animation-delay:70ms] md:text-[clamp(5rem,10.4vw,10.5rem)]">
              {HERO.title.map((part) => (
                <span key={part.text}>
                  {part.text}
                  {part.breakOn === "phone" ? (
                    <>
                      <br className="md:hidden" />
                      <span className="hidden md:inline"> </span>
                    </>
                  ) : part.breakOn === "wide" ? (
                    <>
                      <br className="hidden md:inline" />
                      <span className="md:hidden"> </span>
                    </>
                  ) : null}
                </span>
              ))}
            </h1>
          )}

          <div className="hidden md:block">
            <HeroPitch
              cta={cta}
              fromCents={from?.priceCents ?? null}
              lead={words?.lead}
            />
          </div>
        </div>

        <div className="relative mt-3 md:mt-0">
          {MEDIA.heroLoop ? (
            <div className="border-navy shadow-hard-cream mx-auto max-w-[24rem] overflow-hidden rounded-[22px] border-[3px] md:max-w-none">
              <LoopVideo
                media={MEDIA.heroLoop}
                eager
                className="h-[min(36svh,22rem)] w-full object-cover md:h-auto"
              />
            </div>
          ) : (
            <div className="hero-lucky mx-auto w-full max-w-[27rem] md:max-w-none">
              <LuckyRun
                animated
                shareable
                title={HERO.luckyAlt}
                className="h-auto max-h-[30svh] w-full md:max-h-none"
              />
            </div>
          )}

          {/* An official sticker, slapped on the corner. */}
          <div
            className="animate-stamp absolute -right-2 -bottom-7 z-20 w-[25%] max-w-[8.5rem] [animation-delay:620ms] md:right-[2%] md:-bottom-4 md:w-[24%] md:max-w-[11rem]"
            style={
              {
                "--stamp-from": "26deg",
                "--stamp-to": "11deg",
              } as React.CSSProperties
            }
          >
            <Art
              name="sticker-big-dill"
              alt=""
              sizes="(min-width: 768px) 176px, 25vw"
              className="h-auto w-full"
              eager
            />
          </div>
        </div>

        <div className="relative z-10 mt-4 md:hidden">
          <HeroPitch
            cta={cta}
            fromCents={from?.priceCents ?? null}
            lead={words?.lead}
          />
        </div>
      </div>
    </section>
  );
}

function HeroPitch({
  cta,
  fromCents,
  lead,
}: {
  /** What the button says and where it leads: pre-order, buy, or the crew. */
  readonly cta: { readonly label: string; readonly href: string };
  readonly fromCents: number | null;
  /** A landing page's own sentence, in place of the standard one. */
  readonly lead?: string;
}) {
  return (
    <div className="md:mt-9">
      <a
        href={cta.href}
        className="btn btn-lg btn-on-pink btn-block md:inline-flex md:w-auto"
      >
        <span className="cap-trim">{cta.label}</span>
        <ArrowIcon className="size-6" />
      </a>

      <div className="card mt-7 -rotate-[0.6deg] p-5 md:mt-9 md:max-w-[31rem] md:p-6">
        <p className="text-[1.0625rem] leading-relaxed md:text-[1.125rem]">
          {lead ?? HERO.body}
        </p>
        <ul className="mt-4 flex flex-col gap-2">
          {HERO.points.map((point) => (
            <li
              key={point}
              className="label flex items-center gap-2 text-[1.1rem] leading-tight"
            >
              <CheckIcon className="text-pink-deep size-5 shrink-0" />
              <span className="cap-trim">{point}</span>
            </li>
          ))}
          {fromCents !== null ? (
            <li className="label flex items-center gap-2 text-[1.1rem] leading-tight">
              <CheckIcon className="text-pink-deep size-5 shrink-0" />
              <span className="cap-trim">
                {HERO.packsFrom} {formatNzd(fromCents)}
              </span>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
