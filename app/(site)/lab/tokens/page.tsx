import type { Metadata } from "next";
import type { ReactNode } from "react";

import { FONT_LICENCES } from "@/lib/brand/fonts";
import {
  contrastRatio,
  DARK_PIGMENTS,
  evaluateFluid,
  FLUID_SPACE,
  formatRatio,
  fullMotion,
  isLargeText,
  LIGHT_PIGMENTS,
  measuredPairs,
  measuredSemanticPairs,
  pairsFor,
  reducedMotion,
  SEMANTIC_COLORS,
  TYPE_SCALE,
  type MeasuredSemanticPair,
  type Pigment,
  type Scheme,
  type SemanticColorName,
} from "@/lib/brand";

import { MotionSpecimen } from "./motion-specimen";
import { SchemeSwitch } from "./scheme-switch";

export const metadata: Metadata = {
  title: "Design tokens",
  description:
    "The HALF SOUR token layer: pigments, sanctioned pairs, the semantic layer, type, spacing, elevation and motion.",
  // An internal specimen. It is not a page of the shop and must never rank.
  robots: { index: false, follow: false, nocache: true },
};

/* ------------------------------------------------------------------ shell */

function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="border-hairline border-t pt-block pb-block">
      <p className="text-eyebrow text-muted mb-2 uppercase">{eyebrow}</p>
      <h2 className="text-heading-1 text-primary font-display">{title}</h2>
      {intro ? (
        <p className="text-body text-muted mt-stack max-w-prose">{intro}</p>
      ) : null}
      <div className="mt-block">{children}</div>
    </section>
  );
}

/** Tables are the one thing that always overflows at 375px. Scroll them. */
function TableScroll({ children }: { children: ReactNode }) {
  return (
    <div className="border-hairline overflow-x-auto rounded-md border">
      {children}
    </div>
  );
}

function Verdict({ passes }: { passes: boolean }) {
  return (
    <span
      className={
        passes ? "text-primary font-semibold" : "text-danger font-semibold"
      }
    >
      {passes ? "PASS" : "FAIL"}
    </span>
  );
}

/* ---------------------------------------------------------------- pigments */

/**
 * Swatches are the one place in the build that paints a pigment directly.
 * The values come from lib/brand, never from a literal in this file, and the
 * point of the page is to show the pigment, so the semantic rule is suspended
 * here on purpose.
 */
function PigmentCard({
  scheme,
  name,
  pigment,
}: {
  scheme: Scheme;
  name: string;
  pigment: Pigment;
}) {
  const partners = pairsFor(scheme).filter(
    (pair) => pair.fg === name || pair.bg === name,
  );
  const pigments = scheme === "light" ? LIGHT_PIGMENTS : DARK_PIGMENTS;

  return (
    <article className="border-hairline bg-surface-raised overflow-hidden rounded-md border">
      <div
        className="h-20 w-full"
        style={{ backgroundColor: pigment.hex }}
        aria-hidden="true"
      />
      <div className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-heading-3 text-primary">{pigment.label}</h3>
          <code className="text-mono text-muted font-mono">{pigment.hex}</code>
        </div>
        <p className="text-caption text-muted mt-1">{pigment.role}</p>
        <p className="text-caption text-muted mt-3">
          <span className="text-eyebrow uppercase">
            sanctioned {partners.length === 1 ? "pair" : "pairs"}
          </span>
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {partners.map((pair) => {
            const fg = pigments[pair.fg as keyof typeof pigments] as Pigment;
            const bg = pigments[pair.bg as keyof typeof pigments] as Pigment;
            const ratio = contrastRatio(fg.hex, bg.hex);
            return (
              <li
                key={`${pair.fg}-${pair.bg}`}
                className="text-caption flex items-center justify-between gap-3 rounded-xs px-2 py-1"
                style={{ backgroundColor: bg.hex, color: fg.hex }}
              >
                <span>
                  {pair.fg} on {pair.bg}
                </span>
                <span className="font-mono">
                  {formatRatio(ratio)}
                  {pair.sizeClass === "large" ? " · large" : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </article>
  );
}

function PigmentGrid({ scheme }: { scheme: Scheme }) {
  const pigments = scheme === "light" ? LIGHT_PIGMENTS : DARK_PIGMENTS;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Object.entries(pigments).map(([name, pigment]) => (
        <PigmentCard
          key={`${scheme}-${name}`}
          scheme={scheme}
          name={name}
          pigment={pigment as Pigment}
        />
      ))}
    </div>
  );
}

function PairTable({ scheme }: { scheme: Scheme }) {
  return (
    <TableScroll>
      <table className="text-body-sm w-full border-collapse text-left">
        <caption className="sr-only">
          Contrast for every {scheme} pair sanctioned in the brand palette
        </caption>
        <thead className="bg-surface-sunken text-eyebrow uppercase">
          <tr>
            <th scope="col" className="px-3 py-2">
              Sample
            </th>
            <th scope="col" className="px-3 py-2">
              Pair
            </th>
            <th scope="col" className="px-3 py-2">
              Hex
            </th>
            <th scope="col" className="px-3 py-2">
              Measured
            </th>
            <th scope="col" className="px-3 py-2">
              Needs
            </th>
            <th scope="col" className="px-3 py-2">
              Result
            </th>
            <th scope="col" className="px-3 py-2">
              Role
            </th>
          </tr>
        </thead>
        <tbody>
          {measuredPairs(scheme).map((row) => (
            <tr
              key={`${row.fg}-${row.bg}`}
              className="border-hairline border-t"
            >
              <td className="px-3 py-2">
                <span
                  className="inline-block rounded-xs px-3 py-1 whitespace-nowrap"
                  style={{ backgroundColor: row.bgHex, color: row.fgHex }}
                >
                  Half Sour
                </span>
              </td>
              <td className="text-primary px-3 py-2 whitespace-nowrap">
                {row.fg} on {row.bg}
              </td>
              <td className="text-muted px-3 py-2 font-mono whitespace-nowrap">
                {row.fgHex} / {row.bgHex}
              </td>
              <td className="text-primary px-3 py-2 font-mono whitespace-nowrap">
                {formatRatio(row.ratio)}
              </td>
              <td className="text-muted px-3 py-2 whitespace-nowrap">
                {row.threshold.toFixed(1)}:1 ({row.sizeClass})
              </td>
              <td className="px-3 py-2">
                <Verdict passes={row.passes} />
              </td>
              <td className="text-muted px-3 py-2">{row.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

/* --------------------------------------------------------------- semantics */

const SURFACE_TOKENS: readonly {
  token: SemanticColorName;
  on: SemanticColorName;
  utility: string;
}[] = [
  { token: "surface-page", on: "text-primary", utility: "bg-surface" },
  { token: "surface-raised", on: "text-primary", utility: "bg-surface-raised" },
  { token: "surface-sunken", on: "text-primary", utility: "bg-surface-sunken" },
  { token: "surface-deep", on: "text-on-deep", utility: "bg-surface-deep" },
  {
    token: "surface-inverse",
    on: "text-on-inverse",
    utility: "bg-surface-inverse",
  },
  {
    token: "surface-accent",
    on: "text-on-accent",
    utility: "bg-surface-accent",
  },
];

function SurfaceSpecimen() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {SURFACE_TOKENS.map((entry) => (
        <div
          key={entry.token}
          className="border-hairline rounded-md border p-5"
          style={{
            backgroundColor: `var(--${entry.token})`,
            color: `var(--${entry.on})`,
          }}
        >
          <p className="text-eyebrow uppercase opacity-80">--{entry.token}</p>
          <p className="text-heading-3 mt-2">Half Sour</p>
          <p className="text-caption mt-1 opacity-80">
            {SEMANTIC_COLORS[entry.token].intent}
          </p>
          <p className="text-caption mt-3 font-mono opacity-70">
            {entry.utility} · light {SEMANTIC_COLORS[entry.token].light} · dark{" "}
            {SEMANTIC_COLORS[entry.token].dark}
          </p>
        </div>
      ))}
    </div>
  );
}

const TEXT_TOKENS: readonly SemanticColorName[] = [
  "text-primary",
  "text-muted",
  "text-link",
  "text-danger",
];

function TextSpecimen() {
  return (
    <div className="bg-surface-raised border-hairline gap-stack flex flex-col rounded-md border p-6">
      {TEXT_TOKENS.map((token) => (
        <div key={token} className="gap-inline flex flex-col">
          <span className="text-eyebrow text-muted uppercase">--{token}</span>
          <p className="text-body" style={{ color: `var(--${token})` }}>
            Brined for eleven days in the back of the shop. Cucumbers, salt,
            dill, garlic, water. Nothing else, and nothing said about it.
          </p>
          <span className="text-caption text-muted font-mono">
            light {SEMANTIC_COLORS[token].light} · dark{" "}
            {SEMANTIC_COLORS[token].dark}
          </span>
        </div>
      ))}
    </div>
  );
}

function SemanticPairRow({ row }: { row: MeasuredSemanticPair }) {
  return (
    <tr className="border-hairline border-t align-top">
      <td className="text-primary px-3 py-2 whitespace-nowrap">
        {row.fg}
        <span className="text-muted"> on </span>
        {row.bg}
      </td>
      <td className="text-muted px-3 py-2 whitespace-nowrap">
        {row.sizeClass} · needs {row.threshold.toFixed(1)}:1
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span
          className="mr-2 inline-block rounded-xs px-2 py-1"
          style={{
            backgroundColor: row.light.bgHex,
            color: row.light.fgHex,
          }}
        >
          Aa
        </span>
        <span className="text-primary font-mono">
          {formatRatio(row.light.ratio)}
        </span>
        <span className="text-muted">
          {" "}
          · {row.light.fgPigment}/{row.light.bgPigment}
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span
          className="mr-2 inline-block rounded-xs px-2 py-1"
          style={{ backgroundColor: row.dark.bgHex, color: row.dark.fgHex }}
        >
          Aa
        </span>
        <span className="text-primary font-mono">
          {formatRatio(row.dark.ratio)}
        </span>
        <span className="text-muted">
          {" "}
          · {row.dark.fgPigment}/{row.dark.bgPigment}
        </span>
      </td>
      <td className="px-3 py-2">
        <Verdict passes={row.passes} />
      </td>
      <td className="text-muted px-3 py-2">{row.usage}</td>
    </tr>
  );
}

function SemanticPairTable() {
  const rows = measuredSemanticPairs();
  return (
    <TableScroll>
      <table className="text-body-sm w-full border-collapse text-left">
        <caption className="sr-only">
          Every combination the semantic layer names, measured in both schemes
        </caption>
        <thead className="bg-surface-sunken text-eyebrow uppercase">
          <tr>
            <th scope="col" className="px-3 py-2">
              Pairing
            </th>
            <th scope="col" className="px-3 py-2">
              Class
            </th>
            <th scope="col" className="px-3 py-2">
              Light
            </th>
            <th scope="col" className="px-3 py-2">
              Dark
            </th>
            <th scope="col" className="px-3 py-2">
              Result
            </th>
            <th scope="col" className="px-3 py-2">
              Usage
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <SemanticPairRow key={`${row.fg}-${row.bg}`} row={row} />
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

/* --------------------------------------------------------------------- type */

const SPECIMEN_LINE = "Half Sour — pickle brine, bottled with a straight face";

/**
 * Written out as literals on purpose. Tailwind scans source text for class
 * names, so `text-${step.name}` would compile to nothing at all.
 */
const TYPE_CLASS: Record<string, string> = {
  "display-1": "text-display-1",
  "display-2": "text-display-2",
  "display-3": "text-display-3",
  "heading-1": "text-heading-1",
  "heading-2": "text-heading-2",
  "heading-3": "text-heading-3",
  lede: "text-lede",
  body: "text-body",
  "body-sm": "text-body-sm",
  caption: "text-caption",
  eyebrow: "text-eyebrow",
  mono: "text-mono",
};

function TypeSpecimen() {
  return (
    <div className="gap-block flex flex-col">
      {TYPE_SCALE.map((step) => (
        <div key={step.name} className="border-hairline border-t pt-4">
          <div className="text-caption text-muted mb-2 flex flex-wrap gap-x-4 gap-y-1 font-mono">
            <span className="text-primary">text-{step.name}</span>
            <span>
              {step.minPx}px → {step.maxPx}px
            </span>
            <span>
              1280px = {evaluateFluid(step.minPx, step.maxPx, 1280).toFixed(1)}
              px
            </span>
            <span>lh {step.lineHeight}</span>
            <span>tr {step.letterSpacing}</span>
            <span>wt {step.weight}</span>
            <span>
              {step.family === "display"
                ? "Fraunces"
                : step.family === "mono"
                  ? "platform mono"
                  : "Inter Tight"}
            </span>
            {isLargeText(step) ? (
              <span className="text-primary">WCAG large</span>
            ) : null}
          </div>
          <p
            className={[
              TYPE_CLASS[step.name] ?? "text-body",
              "text-primary",
              step.family === "display"
                ? "font-display"
                : step.family === "mono"
                  ? "font-mono"
                  : "font-sans",
              step.transform === "uppercase" ? "uppercase" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {step.name === "eyebrow" ? "In brine we trust" : SPECIMEN_LINE}
          </p>
          <p className="text-caption text-muted mt-2 max-w-prose">
            {step.usage}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ spacing */

function SpacingSpecimen() {
  const fixed = [1, 2, 3, 4, 6, 8, 12, 16, 24];
  return (
    <div className="gap-block flex flex-col">
      <div>
        <h3 className="text-heading-3 text-primary">Fluid</h3>
        <p className="text-caption text-muted mt-1 max-w-prose">
          Tuned across 375px → 1920px. The bars below are measured live, so they
          are the width the browser actually computed at this viewport.
        </p>
        <ul className="mt-4 flex flex-col gap-3">
          {FLUID_SPACE.map((step) => (
            <li key={step.name} className="gap-inline flex flex-col">
              <span className="text-caption text-muted font-mono">
                --spacing-{step.name} · {step.minPx}px → {step.maxPx}px ·{" "}
                {step.usage}
              </span>
              <span
                className="bg-accent border-accent-edge block h-4 max-w-full rounded-xs border"
                style={{ width: `var(--spacing-${step.name})` }}
              />
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-heading-3 text-primary">Fixed step</h3>
        <p className="text-caption text-muted mt-1 max-w-prose">
          Derived from <code className="font-mono">--spacing: 0.25rem</code>.
          p-4 is 1rem.
        </p>
        <ul className="mt-4 flex flex-wrap items-end gap-3">
          {fixed.map((step) => (
            <li key={step} className="gap-inline flex flex-col items-center">
              <span
                className="bg-surface-deep block rounded-xs"
                style={{
                  width: `calc(var(--spacing) * ${step})`,
                  height: `calc(var(--spacing) * ${step})`,
                }}
              />
              <span className="text-caption text-muted font-mono">{step}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* --------------------------------------------------- radius and elevation */

const RADII = ["none", "xs", "sm", "md", "lg", "xl", "pill"] as const;
const ELEVATIONS = [
  { token: "hairline", usage: "A rule that has to read as an edge." },
  { token: "raised", usage: "Cards and inputs." },
  { token: "overlay", usage: "Popovers, dropdowns, the cart drawer." },
  { token: "lifted", usage: "Modals and the mobile sheet." },
  { token: "inset", usage: "Wells and pressed states." },
] as const;

function ShapeSpecimen() {
  return (
    <div className="gap-block flex flex-col">
      <div>
        <h3 className="text-heading-3 text-primary">Radius</h3>
        <ul className="mt-4 flex flex-wrap gap-4">
          {RADII.map((name) => (
            <li key={name} className="gap-inline flex flex-col items-center">
              <span
                className="bg-surface-accent border-accent-edge block h-16 w-16 border"
                style={{ borderRadius: `var(--radius-${name})` }}
              />
              <span className="text-caption text-muted font-mono">
                rounded-{name}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-heading-3 text-primary">Elevation</h3>
        <p className="text-caption text-muted mt-1 max-w-prose">
          Light is ink-tinted and crisp. Dark is authored separately: an inset
          Shelf rim carries the edge, because a soft shadow is invisible on a
          near-black ground.
        </p>
        <ul className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ELEVATIONS.map((item) => (
            <li key={item.token} className="gap-inline flex flex-col">
              <span
                className="bg-surface-raised text-caption text-muted flex h-24 items-center justify-center rounded-md font-mono"
                style={{ boxShadow: `var(--elevation-${item.token})` }}
              >
                --elevation-{item.token}
              </span>
              <span className="text-caption text-muted">{item.usage}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- focus and touch */

function InteractionSpecimen() {
  return (
    <div className="gap-block flex flex-col">
      <div className="gap-stack flex flex-col">
        <h3 className="text-heading-3 text-primary">Focus and targets</h3>
        <p className="text-caption text-muted max-w-prose">
          Tab through these. One ring for the whole build, from{" "}
          <code className="font-mono">--focus-ring</code>, measured against both
          the page and the card ground. Every control clears 44×44 on a coarse
          pointer.
        </p>
        <div className="gap-inline flex flex-wrap">
          <button
            type="button"
            className="bg-surface-accent text-on-accent border-accent-edge text-body-sm min-h-11 cursor-pointer rounded-sm border px-5 font-semibold"
          >
            Primary — Brine fill, Ink edge
          </button>
          <button
            type="button"
            className="bg-surface-raised text-primary border-strong text-body-sm min-h-11 cursor-pointer rounded-sm border px-5"
          >
            Secondary
          </button>
          <a
            href="#tokens-top"
            className="text-link text-body-sm inline-flex min-h-11 items-center underline decoration-[var(--accent)] decoration-2 underline-offset-4"
          >
            An inline link
          </a>
        </div>
      </div>
      <div className="gap-stack flex flex-col">
        <h3 className="text-heading-3 text-primary">Form floor</h3>
        <p className="text-caption text-muted max-w-prose">
          Controls inherit <code className="font-mono">--text-body</code>, whose
          smallest value is 16px, so iOS never zooms the page on focus.
        </p>
        <label className="gap-inline flex max-w-narrow flex-col">
          <span className="text-body-sm text-primary font-semibold">Email</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.co.nz"
            className="border-strong bg-surface-raised text-primary min-h-11 rounded-sm border px-3"
          />
          <span className="text-caption text-muted">
            Visible label, correct type and inputmode, 16px minimum.
          </span>
        </label>
        <p className="text-danger text-body-sm">
          --text-danger: sold out until the next batch.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export default function TokensSpecimenPage() {
  const lightPairs = measuredPairs("light");
  const darkPairs = measuredPairs("dark");
  const semantic = measuredSemanticPairs();
  const allPass = [...lightPairs, ...darkPairs, ...semantic].every(
    (row) => row.passes,
  );

  return (
    <div id="tokens-top" className="mx-auto w-full max-w-page">
      <header className="pb-block">
        <p className="text-eyebrow text-muted uppercase">
          Internal specimen · noindex
        </p>
        <h1 className="text-display-2 text-primary font-display mt-2">
          Design tokens
        </h1>
        <p className="text-lede text-muted mt-stack max-w-prose">
          Every colour, size, space and easing this build is allowed to use. The
          numbers on this page are computed at render time by{" "}
          <code className="font-mono">lib/brand/report.ts</code> — the same
          module the CI contrast test asserts on, so what you read here is what
          gates the build.
        </p>
        <div className="mt-block gap-inline flex flex-wrap items-center">
          <SchemeSwitch />
          <span className="text-caption text-muted">
            {lightPairs.length + darkPairs.length} sanctioned pairs ·{" "}
            {semantic.length} semantic pairings ·{" "}
            <span
              className={
                allPass
                  ? "text-primary font-semibold"
                  : "text-danger font-semibold"
              }
            >
              {allPass ? "all meet AA" : "one or more fail"}
            </span>
          </span>
        </div>
      </header>

      <Section
        id="pigments-light"
        eyebrow="1 · Pigments"
        title="Light palette"
        intro="Nine colours, ported verbatim from brand/_src/palette.py. Each card lists every ground the brand sanctioned this pigment against, with the measured ratio."
      >
        <PigmentGrid scheme="light" />
        <div className="mt-block">
          <PairTable scheme="light" />
        </div>
      </Section>

      <Section
        id="pigments-dark"
        eyebrow="1 · Pigments"
        title="Dark palette"
        intro="Eight colours, authored separately. Moss and Ember exist only here; Brine is held back one step for a dark ground. Nothing on this row is a transform of the row above."
      >
        <PigmentGrid scheme="dark" />
        <div className="mt-block">
          <PairTable scheme="dark" />
        </div>
      </Section>

      <Section
        id="semantics"
        eyebrow="2 · Semantic layer"
        title="Intent, not pigment"
        intro="Components name a role and never a colour. These blocks are painted by the same custom properties a component would use, so they follow the switch at the top of this page."
      >
        <SurfaceSpecimen />
        <div className="mt-block">
          <TextSpecimen />
        </div>
        <div className="mt-block">
          <h3 className="text-heading-3 text-primary mb-4">
            Every pairing the layer names
          </h3>
          <SemanticPairTable />
        </div>
      </Section>

      <Section
        id="type"
        eyebrow="3 · Type"
        title="Fraunces against Inter Tight"
        intro={
          <>
            A high-contrast display serif with a live optical-size axis, set
            against a tight grotesk. Self-hosted by next/font with a
            metric-matched fallback, so the swap costs no layout shift.{" "}
            {FONT_LICENCES.map(
              (licence) => `${licence.family} (${licence.licence})`,
            ).join(", ")}
            .
          </>
        }
      >
        <TypeSpecimen />
      </Section>

      <Section
        id="spacing"
        eyebrow="4 · Space"
        title="Fluid and fixed"
        intro="Layout space is fluid across 375 → 1920. Component space is a fixed step scale, because a button's padding should not breathe with the window."
      >
        <SpacingSpecimen />
      </Section>

      <Section id="shape" eyebrow="5 · Shape" title="Radius and elevation">
        <ShapeSpecimen />
      </Section>

      <Section
        id="motion"
        eyebrow="6 · Motion"
        title="One vocabulary, two designs"
        intro={`Durations, easings, staggers and travel, named as intent. Under prefers-reduced-motion the same keyframes become the reduced design: enter is ${fullMotion.duration.enter}ms with ${fullMotion.distance.md}px of travel, and ${reducedMotion.duration.enter}ms with ${reducedMotion.distance.md}px — a fade in the same order, at the same pace, going nowhere.`}
      >
        <MotionSpecimen />
      </Section>

      <Section
        id="interaction"
        eyebrow="7 · Interaction"
        title="Focus, targets and the form floor"
      >
        <InteractionSpecimen />
      </Section>
    </div>
  );
}
