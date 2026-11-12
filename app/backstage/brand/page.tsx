import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Art, type ArtName } from "@/components/brand/Art";
import { Bottle } from "@/components/brand/Bottle";
import {
  ArrowIcon,
  BottleIcon,
  Burst,
  CalendarIcon,
  CheckIcon,
  DropIcon,
  FaceIcon,
  HeartIcon,
  JarIcon,
  LockIcon,
  Sparkle,
  StraightIcon,
  TruckIcon,
} from "@/components/brand/Icons";
import {
  CHANGES,
  COLOUR_RULES,
  IDEA,
  LAYOUT,
  LOGO,
  MASCOT,
  MOTION,
  NEVER,
  PILLARS,
  TYPE,
  VOICE,
} from "@/content/brand-guide";
import { hexOf, PAIRS, PALETTE } from "@/lib/brand/colours";
import { contrastRatio, thresholdFor } from "@/lib/brand/contrast";

export const metadata: Metadata = { title: "Brand guide" };

/**
 * The living brand guide.
 *
 * Nothing on this page is a picture of the brand. The swatches are the
 * tokens, the contrast figures are computed as it renders, the specimens are
 * set in the loaded fonts and the buttons are the site's buttons. If the
 * site changes, this changes with it.
 */

const SECTIONS = [
  { id: "idea", label: "The idea" },
  { id: "voice", label: "Voice" },
  { id: "never", label: "Never say" },
  { id: "logo", label: "Logo" },
  { id: "lucky", label: "Lucky" },
  { id: "colour", label: "Colour" },
  { id: "type", label: "Type" },
  { id: "parts", label: "Parts" },
  { id: "motion", label: "Motion" },
  { id: "layout", label: "Layout" },
  { id: "changes", label: "What changed" },
] as const;

const TYPE_CLASS: Readonly<Record<string, string>> = {
  display: "display text-[clamp(3rem,13vw,5.5rem)] leading-[0.9]",
  varsity: "varsity text-[clamp(2.25rem,9vw,3.5rem)] leading-[0.95]",
  label: "label text-[1.75rem] leading-none",
  sans: "text-[1.125rem] leading-relaxed",
};

const SWATCH_CLASS: Readonly<Record<string, string>> = {
  navy: "bg-navy",
  pink: "bg-pink",
  olive: "bg-olive",
  cream: "bg-cream",
  "cream-art": "bg-cream-art",
  paper: "bg-paper",
  "pink-deep": "bg-pink-deep",
  "olive-deep": "bg-olive-deep",
  "navy-muted": "bg-navy-muted",
  "olive-wash": "bg-olive-wash",
  blush: "bg-blush",
  mist: "bg-mist",
  white: "bg-white",
};

function Section({
  id,
  title,
  lead,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly lead?: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="border-navy scroll-mt-24 border-t-[3px] py-12 md:py-16"
    >
      <h2
        id={`${id}-title`}
        className="varsity text-[clamp(2.25rem,9vw,3.5rem)] leading-[0.95]"
      >
        {title}
      </h2>
      {lead ? (
        <p className="mt-4 max-w-[42rem] text-[1.0625rem] leading-relaxed">
          {lead}
        </p>
      ) : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Rules({ items }: { readonly items: readonly string[] }) {
  return (
    <ul className="flex max-w-[44rem] flex-col gap-2.5">
      {items.map((item) => (
        <li key={item} className="flex gap-3 leading-relaxed">
          <Sparkle className="text-pink-deep mt-2 size-3 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Tag({
  tone,
  children,
}: {
  readonly tone: "official" | "proposed" | "ours" | "never";
  readonly children: string;
}) {
  const style = {
    official: "bg-olive text-navy",
    proposed: "bg-paper text-navy",
    ours: "bg-navy text-cream",
    never: "bg-pink-deep text-white",
  }[tone];
  return (
    <span
      className={`label border-navy inline-flex rounded-full border-2 px-2.5 py-1 text-[0.95rem] leading-none ${style}`}
    >
      <span className="cap-trim">{children}</span>
    </span>
  );
}

export default function BrandGuidePage() {
  return (
    <>
      <div className="on-pink bg-pink px-gutter py-12 md:py-16">
        <div className="max-w-page mx-auto grid items-center gap-8 md:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="label text-navy text-[1.25rem]">
              Quick Pickle brand guide
            </p>
            <h1 className="display text-cream mt-3 text-[min(21vw,8rem)] leading-[0.88]">
              {IDEA.line}
            </h1>
            <p className="label text-navy mt-5 max-w-[30rem] text-[1.3rem] leading-tight">
              The working version, as the site follows it. Built from Ashleigh
              Lennard&apos;s files.
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- a static vector file; there is nothing for the optimiser to do */}
          <img
            src="/brand/lockup-stacked.svg"
            alt="Quick Pickle stacked lockup"
            width={153}
            height={175}
            className="mx-auto h-auto w-[55%] max-w-[18rem] md:w-full"
          />
        </div>
      </div>

      <nav
        aria-label="Guide sections"
        className="bg-paper border-navy sticky top-14 z-30 border-b-[3px]"
      >
        <ul className="max-w-page px-gutter no-scrollbar mx-auto flex gap-1 overflow-x-auto">
          {SECTIONS.map((section) => (
            <li key={section.id} className="shrink-0">
              <a
                href={`#${section.id}`}
                className="label hover:text-pink-deep flex min-h-11 items-center px-2.5 text-[1.05rem] whitespace-nowrap"
              >
                <span className="cap-trim">{section.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="max-w-page px-gutter mx-auto pb-20">
        <Section id="idea" title="The idea" lead={IDEA.summary}>
          <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
            <div>
              <h3 className="label text-[1.25rem]">
                Why this and not the deck
              </h3>
              <div className="mt-3">
                <Rules items={IDEA.why} />
              </div>
              <h3 className="label mt-8 text-[1.25rem]">Who it is for</h3>
              <p className="mt-2 max-w-[40rem] leading-relaxed">
                {IDEA.audience}
              </p>
            </div>
            <div>
              <h3 className="label text-[1.25rem]">
                The four things we talk about
              </h3>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {PILLARS.map((pillar) => (
                  <li key={pillar.name} className="card-flat p-4">
                    <p className="varsity text-[1.4rem] leading-none">
                      {pillar.name}
                    </p>
                    <p className="mt-2 text-[0.9688rem] leading-snug">
                      {pillar.say}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        <Section id="voice" title="Voice" lead={VOICE.summary}>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="card-flat bg-olive-wash p-5">
              <h3 className="label text-[1.25rem]">Do</h3>
              <ul className="mt-3 flex flex-col gap-2">
                {VOICE.dos.map((item) => (
                  <li key={item} className="flex gap-2.5 leading-snug">
                    <CheckIcon className="text-olive-deep mt-0.5 size-5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="card-flat bg-blush p-5">
              <h3 className="label text-pink-deep text-[1.25rem]">
                Don&apos;t
              </h3>
              <ul className="mt-3 flex flex-col gap-2">
                {VOICE.donts.map((item) => (
                  <li key={item} className="flex gap-2.5 leading-snug">
                    <span
                      aria-hidden="true"
                      className="text-pink-deep label mt-0.5 text-[1.1rem] leading-none"
                    >
                      ✕
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-8 grid gap-8 md:grid-cols-3">
            <div>
              <h3 className="label flex items-center gap-2 text-[1.25rem]">
                Ashleigh&apos;s lines <Tag tone="official">Official</Tag>
              </h3>
              <ul className="mt-3 flex flex-col gap-2">
                {VOICE.official.map((line) => (
                  <li
                    key={line}
                    className="varsity text-[1.3rem] leading-tight"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="label flex items-center gap-2 text-[1.25rem]">
                Lines written for the site <Tag tone="ours">Ours</Tag>
              </h3>
              <ul className="mt-3 flex flex-col gap-2">
                {VOICE.ours.map((line) => (
                  <li
                    key={line}
                    className="varsity text-[1.3rem] leading-tight"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="label text-[1.25rem]">Our words for things</h3>
              <dl className="mt-3 flex flex-col gap-2">
                {VOICE.vocabulary.map((item) => (
                  <div key={item.use}>
                    <dt className="font-semibold">{item.use}</dt>
                    <dd className="text-navy-muted text-[0.9375rem]">
                      not &ldquo;{item.for}&rdquo;
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </Section>

        <Section id="never" title="Never say" lead={NEVER.intro}>
          <ul className="flex flex-col gap-3">
            {NEVER.lines.map((item) => (
              <li
                key={item.line}
                className="card-flat grid gap-2 p-4 md:grid-cols-[7rem_1fr_1.1fr] md:items-start md:gap-5"
              >
                <div>
                  <Tag tone={item.status === "Never" ? "never" : "proposed"}>
                    {item.status}
                  </Tag>
                </div>
                <p className="font-semibold line-through decoration-2">
                  &ldquo;{item.line}&rdquo;
                </p>
                <p className="text-[0.9688rem] leading-snug">{item.why}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-[44rem] leading-relaxed">
            {NEVER.alsoAvoid}
          </p>
          <p className="text-navy-muted mt-3 max-w-[44rem] text-[0.9375rem] leading-relaxed">
            The full rules and the law behind them are in{" "}
            <code>legal/COPY-RULES.md</code>. Running{" "}
            <code>npm run audit:copy</code> fails the build on any of these.
          </p>
        </Section>

        <Section id="logo" title="Logo">
          <div className="grid gap-5 md:grid-cols-3">
            <figure className="border-navy bg-navy grid place-items-center rounded-[18px] border-[3px] p-6">
              <Art
                name="logo-primary"
                alt="Primary logo on navy"
                sizes="(min-width: 768px) 320px, 80vw"
                className="h-auto w-full"
              />
              <figcaption className="label text-cream mt-4 text-[1rem]">
                Primary, on navy
              </figcaption>
            </figure>
            <figure className="border-navy bg-cream grid place-items-center rounded-[18px] border-[3px] p-6">
              <Art
                name="logo-primary"
                alt="Primary logo on cream"
                sizes="(min-width: 768px) 320px, 80vw"
                className="h-auto w-full"
              />
              <figcaption className="label mt-4 text-[1rem]">
                Primary, on cream
              </figcaption>
            </figure>
            <figure className="border-navy bg-pink on-pink grid place-items-center rounded-[18px] border-[3px] p-6">
              {/* eslint-disable-next-line @next/next/no-img-element -- a static vector file; there is nothing for the optimiser to do */}
              <img
                src="/brand/lockup-stacked.svg"
                alt="Stacked knockout lockup on pink"
                width={153}
                height={175}
                loading="lazy"
                className="h-auto w-[62%]"
              />
              <figcaption className="label text-navy mt-4 text-[1.2rem]">
                Stacked knockout, on pink
              </figcaption>
            </figure>
          </div>
          <div className="mt-8">
            <Rules items={LOGO.rules} />
          </div>
        </Section>

        <Section id="lucky" title="Lucky">
          <Rules items={MASCOT.rules} />

          <h3 className="label mt-10 flex items-center gap-2 text-[1.25rem]">
            Her drawings <Tag tone="official">Official</Tag>
          </h3>
          <ul className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {MASCOT.official.map((item) => (
              <li key={item.art}>
                <div
                  className={`border-navy grid aspect-square place-items-center rounded-[16px] border-[3px] p-3 ${
                    item.kind === "vector" ? "bg-pink" : "bg-paper"
                  }`}
                >
                  {item.kind === "vector" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a static vector file; there is nothing for the optimiser to do
                    <img
                      src={`/brand/${item.art}.svg`}
                      alt=""
                      loading="lazy"
                      className="max-h-full w-auto max-w-full"
                    />
                  ) : (
                    <Art
                      name={item.art as ArtName}
                      alt=""
                      sizes="180px"
                      className="max-h-full w-auto max-w-full"
                    />
                  )}
                </div>
                <p className="mt-2 text-[0.875rem] leading-snug">
                  {item.label}
                </p>
              </li>
            ))}
          </ul>

          <h3 className="label mt-10 flex items-center gap-2 text-[1.25rem]">
            Generated from her art <Tag tone="proposed">Awaiting her nod</Tag>
          </h3>
          <p className="mt-2 max-w-[44rem] text-[0.9688rem] leading-relaxed">
            {MASCOT.proposedNote}
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {MASCOT.proposed.map((item) => (
              <li key={item.art}>
                <div
                  className={`border-navy bg-paper grid aspect-square place-items-center rounded-[16px] p-3 ${
                    item.inUse ? "border-[3px]" : "border-2 border-dashed"
                  }`}
                >
                  <Art
                    name={item.art as ArtName}
                    alt=""
                    sizes="180px"
                    className="max-h-full w-auto max-w-full"
                  />
                </div>
                <p className="mt-2 text-[0.875rem] leading-snug">
                  {item.label}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="colour" title="Colour">
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {PALETTE.map((swatch) => (
              <li key={swatch.token} className="card-flat overflow-hidden">
                <div
                  className={`border-navy h-24 border-b-[3px] ${SWATCH_CLASS[swatch.token] ?? ""}`}
                />
                <div className="p-3.5">
                  <p className="varsity text-[1.25rem] leading-none">
                    {swatch.name}
                  </p>
                  <p className="label text-navy-muted mt-1.5 text-[1rem]">
                    {swatch.hex}
                  </p>
                  <p className="mt-2">
                    <Tag
                      tone={
                        swatch.source === "official"
                          ? "official"
                          : swatch.source === "sampled"
                            ? "ours"
                            : "proposed"
                      }
                    >
                      {swatch.source}
                    </Tag>
                  </p>
                  <p className="mt-2 text-[0.875rem] leading-snug">
                    {swatch.role}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-10 grid gap-10 lg:grid-cols-2 [&>*]:min-w-0">
            <div>
              <h3 className="label text-[1.25rem]">The rules</h3>
              <div className="mt-3">
                <Rules items={COLOUR_RULES} />
              </div>
            </div>
            <div>
              <h3 className="label text-[1.25rem]">
                Contrast, computed (WCAG 2.2 AA)
              </h3>
              <div className="card-flat mt-3 overflow-x-auto">
                <table className="w-full min-w-[26rem] text-left text-[0.9375rem]">
                  <thead>
                    <tr className="border-navy border-b-2">
                      <th scope="col" className="label px-3 py-2 text-[1rem]">
                        Pair
                      </th>
                      <th scope="col" className="label px-3 py-2 text-[1rem]">
                        Ratio
                      </th>
                      <th scope="col" className="label px-3 py-2 text-[1rem]">
                        For
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {PAIRS.map((pair) => {
                      const ratio = contrastRatio(
                        hexOf(pair.fg),
                        hexOf(pair.bg),
                      );
                      const passes = ratio >= thresholdFor(pair.use);
                      return (
                        <tr
                          key={`${pair.fg}-${pair.bg}-${pair.use}`}
                          className="border-navy-line border-b last:border-0"
                        >
                          <td className="px-3 py-2">
                            {pair.fg} on {pair.bg}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {ratio.toFixed(2)}{" "}
                            <span
                              className={
                                passes ? "text-olive-deep" : "text-pink-deep"
                              }
                            >
                              {passes ? "pass" : "FAIL"}
                            </span>
                          </td>
                          <td className="text-navy-muted px-3 py-2">
                            {pair.use === "body"
                              ? "any text"
                              : pair.use === "large"
                                ? "large type only"
                                : "controls"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Section>

        <Section id="type" title="Type">
          <ul className="flex flex-col gap-6">
            {TYPE.map((face) => (
              <li
                key={face.family}
                className="card-flat grid gap-4 p-5 md:grid-cols-[16rem_1fr] md:gap-8"
              >
                <div>
                  <p className="label text-pink-deep text-[1.15rem]">
                    {face.family}
                  </p>
                  <p className="mt-2 text-[0.9688rem] leading-snug">
                    {face.role}
                  </p>
                  <p className="text-navy-muted mt-2 text-[0.875rem] leading-snug">
                    {face.rule}
                  </p>
                </div>
                <p className={TYPE_CLASS[face.token]}>{face.sample}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="parts"
          title="Parts"
          lead="The real components, not pictures of them. Press one."
        >
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="card-flat flex flex-col items-start gap-5 p-6">
              <p className="label text-[1.1rem]">On cream</p>
              <button type="button" className="btn btn-lg">
                <span className="cap-trim">Pre-order · $48</span>
              </button>
              <button type="button" className="btn btn-olive">
                <span className="cap-trim">In the jar!</span>
              </button>
              <button type="button" className="btn btn-sm btn-cream">
                <span className="cap-trim">Swap</span>
              </button>
              <button type="button" className="btn" disabled>
                <span className="cap-trim">Sold out</span>
              </button>
            </div>
            <div className="on-pink bg-pink border-navy flex flex-col items-start gap-5 rounded-[18px] border-[3px] p-6">
              <p className="label text-navy text-[1.2rem]">On pink</p>
              <button type="button" className="btn btn-lg btn-on-pink">
                <span className="cap-trim">Grab a pack</span>
                <ArrowIcon className="size-6" />
              </button>
              <div className="card -rotate-1 p-4">
                <p className="text-[0.9688rem] leading-snug">
                  Sentences on pink live on a cream card like this one.
                </p>
              </div>
            </div>
            <div className="on-navy bg-navy text-cream border-navy-deep flex flex-col items-start gap-5 rounded-[18px] border-[3px] p-6">
              <p className="label text-olive text-[1.1rem]">On navy</p>
              <button type="button" className="btn btn-on-navy">
                <span className="cap-trim">I&apos;m in</span>
              </button>
              <div className="bg-cream text-navy border-navy-deep shadow-hard-pink rounded-[18px] border-[3px] p-4">
                <p className="varsity text-[1.4rem] leading-none">
                  Just the juice
                </p>
                <p className="mt-2 text-[0.9375rem] leading-snug">
                  A cream card on navy takes the pink offset.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <div className="card-flat p-6">
              <p className="label text-[1.1rem]">Icons</p>
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <JarIcon className="size-10" />
                <TruckIcon className="size-10" />
                <CalendarIcon className="size-10" />
                <HeartIcon className="size-10" />
                <LockIcon className="size-10" />
                <DropIcon className="size-12" />
                <BottleIcon className="size-12" />
                <FaceIcon className="size-12" />
                <StraightIcon className="size-12" />
                <Burst className="text-pink size-12" />
                <Sparkle className="text-pink size-6" />
              </div>
              <p className="text-navy-muted mt-4 text-[0.875rem] leading-snug">
                Thick navy outline, flat fills, round joins, no lettering.
              </p>
            </div>
            <div className="card-flat bg-olive-wash flex items-end gap-5 p-6">
              <Bottle
                className="h-44 w-auto shrink-0"
                title="The illustrated bottle"
              />
              <div>
                <p className="label text-[1.1rem]">The bottle</p>
                <p className="mt-2 text-[0.9375rem] leading-snug">
                  A drawing of the real one: 100 ml, clear plastic, wide white
                  ribbed cap, clear juice, pink wrap label. It stands in until
                  there are clean photos of the printed labels.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8">
            <p className="label text-[1.1rem]">Stickers</p>
            <ul className="mt-3 flex flex-wrap gap-3">
              {(
                [
                  "sticker-lockup",
                  "sticker-wordmark",
                  "sticker-crew",
                  "sticker-big-dill",
                  "sticker-heart",
                  "sticker-sunglasses",
                  "sticker-hug",
                  "sticker-face",
                ] as const
              ).map((name, index) => (
                <li key={name}>
                  <Art
                    name={name}
                    alt=""
                    sizes="112px"
                    className={`w-28 ${index % 2 === 0 ? "-rotate-6" : "rotate-6"}`}
                  />
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <Section id="motion" title="Motion" lead={MOTION.summary}>
          <div className="grid gap-10 lg:grid-cols-2 [&>*]:min-w-0">
            <Rules items={MOTION.rules} />
            <div className="card-flat overflow-x-auto">
              <table className="w-full text-left text-[0.9375rem]">
                <thead>
                  <tr className="border-navy border-b-2">
                    <th scope="col" className="label px-3 py-2 text-[1rem]">
                      Token
                    </th>
                    <th scope="col" className="label px-3 py-2 text-[1rem]">
                      Time
                    </th>
                    <th scope="col" className="label px-3 py-2 text-[1rem]">
                      Used for
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {MOTION.durations.map((item) => (
                    <tr
                      key={item.name}
                      className="border-navy-line border-b last:border-0"
                    >
                      <td className="px-3 py-2 font-semibold">{item.name}</td>
                      <td className="px-3 py-2">{item.ms}ms</td>
                      <td className="text-navy-muted px-3 py-2">{item.use}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        <Section id="layout" title="Layout">
          <Rules items={LAYOUT} />
        </Section>

        <Section
          id="changes"
          title="What changed"
          lead="Brand Guide v2 was a first write-up of Ashleigh's files. These are the places this build departs from it, and why."
        >
          <ul className="flex flex-col gap-4">
            {CHANGES.map((change) => (
              <li
                key={change.to}
                className="card-flat grid gap-3 p-5 md:grid-cols-3 md:gap-6"
              >
                <div>
                  <p className="label text-navy-muted text-[1rem]">Was</p>
                  <p className="text-navy-muted mt-1 text-[0.9688rem] leading-snug">
                    {change.from}
                  </p>
                </div>
                <div>
                  <p className="label text-pink-deep text-[1rem]">Now</p>
                  <p className="mt-1 text-[0.9688rem] leading-snug font-semibold">
                    {change.to}
                  </p>
                </div>
                <div>
                  <p className="label text-[1rem]">Because</p>
                  <p className="mt-1 text-[0.9688rem] leading-snug">
                    {change.why}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
