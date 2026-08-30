import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The admin's building blocks.
 *
 * Three rules hold this together, and they are why the screens look like one
 * product rather than nine:
 *
 *  - **Semantic tokens only.** No component here names a pigment or a hex.
 *    Grounds are `surface-*`, type is `text-*`, lines are `border-hairline`.
 *  - **Every number carries its label.** `Stat` will not render without one.
 *  - **Nothing is empty and silent.** `EmptyState` takes what the section is
 *    for and what will fill it, because "No data" teaches nobody anything.
 */

type Tone = "neutral" | "quiet" | "accent" | "danger" | "strong" | "positive";

const BADGE_TONES: Record<Tone, string> = {
  neutral: "border-hairline text-muted",
  quiet: "border-transparent bg-surface-sunken text-primary",
  accent: "border-accent-edge bg-surface-accent text-on-accent",
  danger: "border-danger/40 bg-danger/10 text-danger",
  strong: "border-transparent bg-surface-inverse text-on-inverse",
  positive: "border-hairline text-primary",
};

/** A small status word. Never the only carrier of meaning — always paired. */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-2 py-0.5 text-caption leading-none font-medium whitespace-nowrap ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** The live dot. Uses the second accent, which is sanctioned for exactly this. */
export function Dot({ tone = "live" }: { tone?: "live" | "warn" | "quiet" }) {
  const fill =
    tone === "live"
      ? "bg-accent-secondary"
      : tone === "warn"
        ? "bg-danger"
        : "bg-strong";
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-1.5 shrink-0 rounded-pill ${fill}`}
    />
  );
}

/** A raised panel. The only container this admin uses. */
export function Card({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`rounded-lg border border-hairline bg-surface-raised ${className}`}
    >
      {children}
    </section>
  );
}

/**
 * A card's title bar: what this is, how many, and one way out of it.
 *
 * `action` is a link rather than a button on purpose — everything in this
 * admin that looks clickable goes somewhere that exists.
 */
export function CardHeader({
  title,
  count,
  note,
  action,
}: {
  title: string;
  count?: number;
  note?: string;
  action?: { readonly label: string; readonly href: string };
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hairline px-4 py-3">
      <h2 className="flex items-baseline gap-2 font-sans text-body-sm font-semibold tracking-tight text-primary">
        {title}
        {count !== undefined && (
          <span className="text-caption font-normal text-muted tabular-nums">
            {count}
          </span>
        )}
      </h2>
      {note !== undefined && <p className="text-caption text-muted">{note}</p>}
      {action !== undefined && (
        <Link
          href={action.href}
          className="rounded-sm text-caption font-medium text-link underline underline-offset-4 hover:no-underline"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** Padding for card contents that are not a list of rows. */
export function CardBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`px-4 py-3.5 ${className}`}>{children}</div>;
}

/** A hairline-separated list. The workhorse layout of the whole admin. */
export function Rows({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-hairline">{children}</ul>;
}

export function Row({
  children,
  href,
  className = "",
}: {
  children: ReactNode;
  href?: string;
  className?: string;
}) {
  const padding = `block px-4 py-3 ${className}`;
  return (
    <li>
      {href === undefined ? (
        <div className={padding}>{children}</div>
      ) : (
        <Link
          href={href}
          className={`${padding} transition-colors hover:bg-surface-page focus-visible:bg-surface-page`}
        >
          {children}
        </Link>
      )}
    </li>
  );
}

/**
 * One number, with the words that make it mean something.
 *
 * `label` is required and `hint` is where the plain-English explanation goes —
 * "the GST inside those takings, which you owe to IRD" rather than a tooltip
 * she has to find.
 */
export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "danger";
}) {
  // The hint lives INSIDE the <dd>, not beside it. A <div> may group a
  // dt/dd pair inside a <dl>, but only if that is all it holds — a stray <p>
  // makes the whole list an invalid definition list (axe `definition-list`,
  // WCAG 1.3.1), and a screen reader then loses the label/value pairing that
  // is the only thing giving the number its meaning.
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted">{label}</dt>
      <dd
        className={`mt-0.5 font-sans text-heading-3 font-semibold tabular-nums ${
          tone === "danger" ? "text-danger" : "text-primary"
        }`}
      >
        {value}
        {hint !== undefined && (
          <span className="mt-1 block text-caption font-normal normal-nums text-muted">
            {hint}
          </span>
        )}
      </dd>
    </div>
  );
}

/** A row of stats that reflows to two columns on a phone. */
export function StatGrid({
  children,
  columns = 4,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
}) {
  const wide =
    columns === 2
      ? "sm:grid-cols-2"
      : columns === 3
        ? "sm:grid-cols-3"
        : "sm:grid-cols-2 lg:grid-cols-4";
  return (
    <dl className={`grid grid-cols-2 gap-x-6 gap-y-5 ${wide}`}>{children}</dl>
  );
}

/** Label and value pairs — the shape most reference content wants. */
export function DefinitionList({
  items,
}: {
  items: readonly {
    readonly term: string;
    readonly value: ReactNode;
    readonly hint?: string;
  }[];
}) {
  return (
    <dl className="divide-y divide-hairline">
      {items.map((item) => (
        <div
          key={item.term}
          className="grid gap-x-6 gap-y-0.5 py-2.5 sm:grid-cols-[minmax(9rem,14rem)_1fr]"
        >
          <dt className="text-caption text-muted sm:pt-0.5">{item.term}</dt>
          <dd className="min-w-0 text-body-sm text-primary">
            {item.value}
            {item.hint !== undefined && (
              <span className="mt-0.5 block text-caption text-muted">
                {item.hint}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A horizontal fill showing where a quantity sits against a threshold. */
export function Meter({
  value,
  max,
  label,
  tone = "neutral",
}: {
  value: number;
  max: number;
  label: string;
  tone?: "neutral" | "danger";
}) {
  const fraction = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  return (
    <div
      role="img"
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
    >
      <div
        className={`h-full rounded-pill ${tone === "danger" ? "bg-danger" : "bg-accent-secondary"}`}
        style={{ inlineSize: `${String(Math.round(fraction * 100))}%` }}
      />
    </div>
  );
}

/**
 * What a section is for, when it has nothing to show.
 *
 * Written as teaching rather than reporting: what lives here, what will make
 * something appear, and when that is expected. "No data" is banned.
 */
export function EmptyState({
  headline,
  children,
  fills,
}: {
  headline: string;
  children: ReactNode;
  /** What will make this fill up, in a sentence. */
  fills?: string;
}) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="font-sans text-body-sm font-semibold text-primary">
        {headline}
      </p>
      <div className="mx-auto mt-1.5 max-w-prose text-caption text-muted">
        {children}
      </div>
      {fills !== undefined && (
        <p className="mx-auto mt-2 max-w-prose text-caption text-muted">
          {fills}
        </p>
      )}
    </div>
  );
}

/** A short aside: a rule, a caution, a piece of context. */
export function Callout({
  title,
  children,
  tone = "neutral",
}: {
  title?: string;
  children: ReactNode;
  tone?: "neutral" | "danger";
}) {
  const skin =
    tone === "danger"
      ? "border-danger/40 bg-danger/5"
      : "border-hairline bg-surface-sunken";
  return (
    <div className={`rounded-md border px-3.5 py-3 ${skin}`}>
      {title !== undefined && (
        <p
          className={`text-caption font-semibold ${tone === "danger" ? "text-danger" : "text-primary"}`}
        >
          {title}
        </p>
      )}
      <div className="mt-0.5 text-caption text-muted [&_a]:text-link [&_a]:underline [&_a]:underline-offset-4">
        {children}
      </div>
    </div>
  );
}

/** Long-form copy with the admin's measure and rhythm. */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-prose space-y-3 text-body-sm text-primary [&_a]:text-link [&_a]:underline [&_a]:underline-offset-4 [&_strong]:font-semibold">
      {children}
    </div>
  );
}

/** A person or an agent, as initials in a ring. Never a raw id. */
export function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md";
}) {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const box = size === "sm" ? "size-6 text-[0.625rem]" : "size-9 text-caption";
  return (
    <span
      aria-hidden="true"
      className={`${box} inline-flex shrink-0 items-center justify-center rounded-pill border border-hairline bg-surface-sunken font-semibold tracking-wide text-primary`}
    >
      {letters}
    </span>
  );
}

/**
 * A table that scrolls sideways on a phone instead of squashing.
 *
 * Columns are never dropped silently: at 375px the table is wider than the
 * screen and says so, because a column that vanishes without a word is a
 * column she will never know she is missing.
 */
export function TableScroll({ children }: { children: ReactNode }) {
  return (
    <div>
      <p className="px-4 pt-2.5 text-caption text-muted sm:hidden">
        Scroll sideways for the rest of the columns.
      </p>
      {/*
        `tabIndex` on the scroller, not decoration. A region that scrolls and
        holds nothing focusable cannot be reached by a keyboard at all — there
        is no way to bring the off-screen columns into view without a mouse or
        a trackpad (axe `scrollable-region-focusable`, WCAG 2.1.1). Most admin
        tables happen to contain links and pass by accident; the plan table has
        none and did not. Making the scroller itself a tab stop fixes both,
        and the build's single `:focus-visible` ring in app/globals.css means
        it is visible when it is reached.
      */}
      <div tabIndex={0} className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-body-sm">
          {children}
        </table>
      </div>
    </div>
  );
}

export function Th({
  children,
  numeric = false,
}: {
  children: ReactNode;
  numeric?: boolean;
}) {
  return (
    <th
      scope="col"
      className={`border-b border-hairline px-4 py-2 text-caption font-medium text-muted ${
        numeric ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  numeric = false,
  className = "",
}: {
  children: ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`border-b border-hairline px-4 py-2.5 align-top text-primary ${
        numeric ? "text-right tabular-nums" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}
