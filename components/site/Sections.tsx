import Link from "next/link";

import { Art } from "@/components/brand/Art";
import {
  ArrowIcon,
  BottleIcon,
  ChevronIcon,
  DropIcon,
  FaceIcon,
  HeartIcon,
  Sparkle,
} from "@/components/brand/Icons";
import { LoopVideo } from "@/components/ui/LoopVideo";
import { Ticker } from "@/components/ui/Ticker";
import { faqs, shipDateText } from "@/content/faq";
import { MEDIA } from "@/content/media";
import {
  BUY,
  CREW,
  FAQ,
  FINAL,
  FOOTER,
  LUCKY,
  OFFICIAL,
  REELS,
  RITUAL,
  SPECIAL,
  TICKER,
  TRUTHS,
} from "@/content/site";

import { specialLine } from "@/lib/shop/special-now";
import type { SpecialNow } from "@/lib/shop/store";

import { BuyBox } from "./BuyBox";
import { CrewForm } from "./CrewForm";
import { Reels } from "./Reels";
import { SpecialTicket } from "./SpecialTicket";
import { WhileOn } from "./WhileOn";

/* The static sections of the page, top to bottom. All server-rendered: the
   only JavaScript any of them needs belongs to the buy box and the crew form,
   which are their own client components. */

export function TopTicker({
  special = null,
}: {
  /** A special that is on goes first in the line, where it is seen at once. */
  readonly special?: SpecialNow | null;
}) {
  const line = (items: readonly string[]) => (
    <Ticker
      items={items}
      seconds={36}
      className="label bg-navy-deep text-cream py-2.5 text-[1.05rem]"
      separator={<Sparkle className="text-pink size-3 shrink-0" />}
    />
  );
  if (special === null) return line(TICKER);
  return (
    <WhileOn until={special.endsAt} otherwise={line(TICKER)}>
      {line([specialLine(special, SPECIAL.tag), ...TICKER])}
    </WhileOn>
  );
}

/** The tilted olive band under the hero. Pure brand noise, on purpose. */
export function Band() {
  return (
    <div className="bg-cream relative z-10 -my-3 overflow-hidden py-3">
      <div className="-mx-4 -rotate-[1.6deg]">
        <Ticker
          items={[
            OFFICIAL.tinyPackage,
            OFFICIAL.pickleCrew,
            OFFICIAL.neverFear,
          ]}
          seconds={22}
          reverse
          className="varsity bg-olive text-navy border-navy border-y-[3px] py-3 text-[1.7rem] md:text-[2.2rem]"
          separator={<Sparkle className="text-pink size-5 shrink-0" />}
        />
      </div>
    </div>
  );
}

export function Shop({
  special = null,
}: {
  readonly special?: SpecialNow | null;
}) {
  return (
    <section
      id="shop"
      aria-labelledby="shop-title"
      className="bg-cream px-gutter scroll-mt-16 pt-14 pb-16 md:pt-20 md:pb-24"
    >
      <div className="max-w-page mx-auto">
        <div data-reveal>
          <p className="label text-pink-deep text-[1.2rem]">{BUY.eyebrow}</p>
          <h2
            id="shop-title"
            className="varsity mt-2 text-[clamp(2.6rem,13vw,4.75rem)] leading-[0.95]"
          >
            {BUY.title}
          </h2>
          <p className="mt-3 max-w-[34rem]">{BUY.body}</p>
        </div>
        {special === null ? null : (
          <SpecialTicket special={special} className="mt-6" />
        )}
        <BuyBox
          shipDate={shipDateText()}
          productLoop={MEDIA.productLoop}
          luckyOnPage={MEDIA.heroLoop === null}
        />
      </div>
    </section>
  );
}

const TRUTH_ICON = {
  drop: DropIcon,
  bottle: BottleIcon,
  face: FaceIcon,
  heart: HeartIcon,
} as const;

export function Truths() {
  return (
    <section
      aria-labelledby="truths-title"
      className="on-navy bg-navy text-cream px-gutter relative overflow-hidden py-16 md:py-24"
    >
      <div className="max-w-page mx-auto md:grid md:grid-cols-[0.9fr_1.1fr] md:items-center md:gap-14">
        <div data-reveal>
          <h2
            id="truths-title"
            className="display text-cream text-[min(29vw,8.5rem)] leading-[0.88] md:text-[clamp(5rem,9.6vw,9.5rem)]"
          >
            {TRUTHS.title.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h2>
          <p className="label text-olive mt-4 text-[1.45rem] leading-tight md:text-[1.7rem]">
            {TRUTHS.body}
          </p>
        </div>

        <ul className="mt-9 flex flex-col gap-4 md:mt-0">
          {TRUTHS.cards.map((card, index) => {
            const Icon = TRUTH_ICON[card.icon];
            return (
              <li
                key={card.title}
                data-reveal
                style={{ "--i": index } as React.CSSProperties}
                className="bg-cream text-navy border-navy-deep shadow-hard-pink flex items-start gap-4 rounded-[18px] border-[3px] p-4 md:p-5"
              >
                <Icon className="text-navy size-12 shrink-0 md:size-14" />
                <div className="min-w-0">
                  <h3 className="varsity text-[1.55rem] leading-none md:text-[1.75rem]">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-[0.9688rem] leading-snug md:text-[1rem] md:leading-relaxed">
                    {card.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

const STEP_STICKER = [
  "sticker-hug",
  "sticker-sunglasses",
  "sticker-face",
] as const;

export function Ritual() {
  return (
    <section
      id="ritual"
      aria-labelledby="ritual-title"
      className="bg-cream scroll-mt-16 overflow-hidden pt-16 pb-14 md:pt-24 md:pb-20"
    >
      <div className="max-w-page px-gutter mx-auto">
        <div data-reveal className="max-w-[40rem]">
          <p className="label text-pink-deep text-[1.2rem]">{RITUAL.eyebrow}</p>
          <h2
            id="ritual-title"
            className="varsity mt-2 text-[clamp(2.6rem,13vw,4.75rem)] leading-[0.95]"
          >
            {RITUAL.title}
          </h2>
          <p className="mt-4 text-[1.125rem] leading-relaxed">{RITUAL.body}</p>
        </div>

        <ol className="mt-10 grid gap-6 md:grid-cols-3 md:gap-7">
          {RITUAL.steps.map((step, index) => (
            <li
              key={step.title}
              data-reveal
              style={{ "--i": index } as React.CSSProperties}
              className="card relative p-5 pt-6"
            >
              <span
                aria-hidden="true"
                className="label bg-navy text-cream absolute -top-4 left-5 grid size-9 place-items-center rounded-full text-[1.3rem] leading-none"
              >
                <span className="cap-trim">{index + 1}</span>
              </span>
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="varsity text-[1.85rem] leading-none">
                    {step.title}
                  </h3>
                  <p className="mt-2.5 text-[1rem] leading-relaxed">
                    {step.body}
                  </p>
                </div>
                <Art
                  name={STEP_STICKER[index] ?? "sticker-face"}
                  alt=""
                  sizes="96px"
                  className={`w-24 shrink-0 ${index % 2 === 0 ? "rotate-[7deg]" : "-rotate-[6deg]"}`}
                />
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Other people's rituals, and ours at the end of the line. */}
      <div className="mt-12" data-reveal>
        <Ticker
          items={RITUAL.rituals}
          seconds={30}
          className="label text-navy border-navy bg-paper border-y-[3px] py-3 text-[1.25rem]"
          separator={<Sparkle className="text-olive-deep size-3.5 shrink-0" />}
        />
      </div>
    </section>
  );
}

export function MeetLucky() {
  return (
    <section
      id="lucky"
      aria-labelledby="lucky-title"
      className="on-pink bg-pink relative scroll-mt-16 overflow-hidden px-gutter py-16 md:py-24"
    >
      <div
        aria-hidden="true"
        className="pattern-dots pointer-events-none absolute inset-0 opacity-[0.07]"
      />
      <div className="max-w-page relative mx-auto grid items-center gap-8 md:grid-cols-[0.85fr_1.15fr] md:gap-14">
        <div
          data-reveal
          className="mx-auto w-[62%] max-w-[19rem] md:w-full md:max-w-[24rem]"
        >
          {MEDIA.luckyLoop ? (
            <div className="border-navy shadow-hard-cream overflow-hidden rounded-[22px] border-[3px]">
              <LoopVideo media={MEDIA.luckyLoop} className="h-auto w-full" />
            </div>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- a static vector file; there is nothing for the optimiser to do */}
              <img
                src="/brand/lucky-up.svg"
                alt={LUCKY.alt}
                width={166}
                height={237}
                loading="lazy"
                decoding="async"
                className="animate-bob h-auto w-full motion-reduce:animate-none"
              />
            </>
          )}
        </div>

        <div>
          <h2
            id="lucky-title"
            data-reveal
            className="display text-navy text-[min(26.5vw,8rem)] leading-[0.88] md:text-[clamp(5rem,9vw,9rem)]"
          >
            {LUCKY.title}
          </h2>

          <div data-reveal className="card mt-6 p-5 md:p-7">
            {LUCKY.body.map((paragraph) => (
              <p
                key={paragraph}
                className="mt-3 text-[1.0625rem] leading-relaxed first:mt-0"
              >
                {paragraph}
              </p>
            ))}
            <p className="varsity text-pink-deep mt-4 text-[1.5rem] leading-tight">
              {LUCKY.signoff}
            </p>
          </div>

          {/* The player card. */}
          <div
            data-reveal
            className="bg-navy text-cream border-navy-deep shadow-hard-cream on-navy mt-7 rotate-[0.8deg] rounded-[18px] border-[3px] p-5 md:p-6"
          >
            <p className="label text-olive flex items-center gap-2 text-[1.15rem]">
              <Sparkle className="size-3.5" />
              <span className="cap-trim">{LUCKY.cardTitle}</span>
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2">
              {LUCKY.stats.map((stat) => (
                <div key={stat.label} className="contents">
                  <dt className="label text-olive text-[1.05rem] leading-snug">
                    {stat.label}
                  </dt>
                  <dd className="text-[1rem] leading-snug">{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The swipeable rail of clips. Not rendered until there is a clip to show. */
export function ReelsSection() {
  if (MEDIA.reels.length === 0) return null;
  return (
    <section
      aria-labelledby="reels-title"
      className="bg-olive-wash border-navy overflow-hidden border-y-[3px] py-14 md:py-20"
    >
      <div className="max-w-page px-gutter mx-auto" data-reveal>
        <p className="label text-pink-deep text-[1.2rem]">{REELS.eyebrow}</p>
        <h2
          id="reels-title"
          className="varsity mt-2 text-[clamp(2.6rem,13vw,4.75rem)] leading-[0.95]"
        >
          {REELS.title}
        </h2>
      </div>
      <div className="mt-8">
        <Reels reels={MEDIA.reels} label={REELS.title} />
      </div>
    </section>
  );
}

export function Crew() {
  return (
    <section
      aria-labelledby="crew-title"
      className="on-navy bg-navy text-cream px-gutter relative overflow-hidden py-16 md:py-20"
    >
      <div className="max-w-page mx-auto grid items-center gap-8 md:grid-cols-2 md:gap-14">
        <div data-reveal>
          <h2
            id="crew-title"
            className="varsity text-cream text-[clamp(2.6rem,13vw,4.75rem)] leading-[0.95]"
          >
            {CREW.title}
          </h2>
          <CrewForm />
        </div>

        <div
          data-reveal
          role="img"
          aria-label={CREW.stickersAlt}
          className="relative mx-auto h-56 w-full max-w-[22rem] md:h-72 md:max-w-[26rem]"
        >
          <Art
            name="sticker-crew"
            alt=""
            sizes="(min-width: 768px) 200px, 44vw"
            className="absolute top-0 left-[2%] w-[46%] -rotate-[9deg]"
          />
          <Art
            name="sticker-heart"
            alt=""
            sizes="(min-width: 768px) 190px, 42vw"
            className="absolute top-[6%] right-[2%] w-[44%] rotate-[8deg]"
          />
          <Art
            name="sticker-lockup"
            alt=""
            sizes="(min-width: 768px) 200px, 44vw"
            className="absolute bottom-0 left-[27%] w-[46%] rotate-[3deg]"
          />
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  const items = faqs();
  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="bg-cream px-gutter scroll-mt-16 py-16 md:py-24"
    >
      <div className="mx-auto max-w-[46rem]">
        <h2
          id="faq-title"
          data-reveal
          className="varsity text-[clamp(2.6rem,13vw,4.75rem)] leading-[0.95]"
        >
          {FAQ.title}
        </h2>
        <div className="mt-8 flex flex-col gap-3.5">
          {items.map((item) => (
            <details
              key={item.q}
              data-reveal
              className="card-flat group open:shadow-hard overflow-hidden"
            >
              <summary className="flex min-h-14 items-center justify-between gap-4 px-5 py-3.5">
                <h3 className="text-[1.0625rem] leading-snug font-semibold">
                  {item.q}
                </h3>
                <ChevronIcon className="size-6 shrink-0 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="px-5 pb-5">
                {item.a.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="mt-2.5 leading-relaxed first:mt-0"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section
      aria-labelledby="final-title"
      className="on-pink bg-pink px-gutter relative overflow-hidden pt-14 pb-20 text-center md:pt-24 md:pb-28"
    >
      <div
        aria-hidden="true"
        className="pattern-stripes pointer-events-none absolute inset-0 opacity-[0.055]"
      />
      <div className="relative mx-auto max-w-[46rem]">
        {/* The official stacked lockup, concept page 3. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- a static vector file; there is nothing for the optimiser to do */}
        <img
          src="/brand/lockup-stacked.svg"
          alt={FINAL.lockupAlt}
          width={153}
          height={175}
          loading="lazy"
          decoding="async"
          data-reveal
          className="mx-auto h-auto w-[58%] max-w-[17rem] md:max-w-[20rem]"
        />
        <h2
          id="final-title"
          data-reveal
          className="display text-cream mt-8 text-[min(25vw,7.5rem)] leading-[0.88] md:text-[clamp(5rem,9vw,9rem)]"
        >
          {FINAL.title.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h2>
        <p className="label text-navy mx-auto mt-5 max-w-[22rem] text-[1.35rem] leading-tight md:max-w-none md:text-[1.6rem]">
          {FINAL.body}
        </p>
        <a href="#shop" className="btn btn-lg btn-on-pink mt-8">
          <span className="cap-trim">{FINAL.cta}</span>
          <ArrowIcon className="size-6" />
        </a>
      </div>
    </section>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="on-navy bg-navy text-cream px-gutter pt-14 pb-10">
      <div className="max-w-page mx-auto">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <Art
              name="logo-primary"
              alt={FOOTER.logoAlt}
              sizes="(min-width: 768px) 320px, 70vw"
              className="h-auto w-[70%] max-w-[20rem]"
            />
            <p className="varsity text-olive mt-5 text-[1.5rem] leading-none">
              {FOOTER.tagline}
            </p>
          </div>

          {FOOTER.columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="label text-olive text-[1.2rem]">{column.title}</h2>
              <ul className="mt-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      prefetch={false}
                      className="hover:text-olive flex min-h-11 items-center text-[1rem] transition-colors duration-150"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="border-navy-soft text-cream mt-10 flex flex-col gap-2 border-t-2 pt-6 text-[0.875rem] leading-relaxed md:flex-row md:items-center md:justify-between">
          <p>
            © {year} {FOOTER.legal}
          </p>
          <p>{FOOTER.foodNote}</p>
        </div>
      </div>
    </footer>
  );
}
