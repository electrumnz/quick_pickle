import { Art } from "@/components/brand/Art";
import { ArrowIcon, CheckIcon } from "@/components/brand/Icons";
import { LuckyRun } from "@/components/brand/Vector";
import { LoopVideo } from "@/components/ui/LoopVideo";
import { MEDIA } from "@/content/media";
import { PACKS } from "@/content/offer";
import { HERO } from "@/content/site";
import { formatNzd } from "@/lib/shop/money";

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
export function Hero() {
  const from = PACKS[0];

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
            <span className="cap-trim">{HERO.eyebrow}</span>
          </p>

          {/* Two lines on a phone, sized to span the screen; three on a wide
              screen, where the column is narrower than the viewport. */}
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

          <div className="hidden md:block">
            <HeroPitch fromCents={from?.priceCents ?? null} />
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
          <HeroPitch fromCents={from?.priceCents ?? null} />
        </div>
      </div>
    </section>
  );
}

function HeroPitch({ fromCents }: { readonly fromCents: number | null }) {
  return (
    <div className="md:mt-9">
      <a
        href="#shop"
        className="btn btn-lg btn-on-pink btn-block md:inline-flex md:w-auto"
      >
        <span className="cap-trim">{HERO.cta}</span>
        <ArrowIcon className="size-6" />
      </a>

      <div className="card mt-7 -rotate-[0.6deg] p-5 md:mt-9 md:max-w-[31rem] md:p-6">
        <p className="text-[1.0625rem] leading-relaxed md:text-[1.125rem]">
          {HERO.body}
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
