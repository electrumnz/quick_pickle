import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { Notice, Pill, type PillTone } from "@/components/backstage/ui";
import type { CampaignStatus, CopyCheck, SocialStatus } from "@/db/schema";
import type { CopyVerdict } from "@/lib/backstage/marketing/copy-check";
import {
  hrefFor,
  type Block,
  type Inline,
} from "@/lib/backstage/marketing/markdown";
import { qrMatrix, qrPath } from "@/lib/backstage/marketing/qr";
import {
  CAMPAIGN_LABEL,
  PARTNER_STATUS_LABEL,
  PROMO_STATE_LABEL,
  REVIEW_LABEL,
  SOCIAL_LABEL,
  type PartnerStatus,
  type PromoState,
  type ReviewStatus,
} from "@/lib/backstage/marketing/status";
import { formatNzDateTime } from "@/lib/time";

/**
 * The marketing area's own small parts: its menu, its status pills, the copy
 * check as a person reads it, and plain form fields. Server components, no
 * state, like the shared ones in components/backstage/ui.tsx.
 */

/* ---- the area's menu --------------------------------------------------- */

const SECTIONS = [
  { key: "overview", href: "/backstage/marketing", label: "At a glance" },
  {
    key: "campaigns",
    href: "/backstage/marketing/campaigns",
    label: "Campaigns",
  },
  {
    key: "promo-codes",
    href: "/backstage/marketing/promo-codes",
    label: "Promo codes",
  },
  { key: "social", href: "/backstage/marketing/social", label: "Social" },
  { key: "links", href: "/backstage/marketing/links", label: "Links" },
  { key: "pages", href: "/backstage/marketing/pages", label: "Pages" },
  { key: "reviews", href: "/backstage/marketing/reviews", label: "Reviews" },
  { key: "partners", href: "/backstage/marketing/partners", label: "Partners" },
] as const;

export type MarketingSection = (typeof SECTIONS)[number]["key"];

export function MarketingNav({
  current,
}: {
  readonly current: MarketingSection;
}) {
  return (
    <nav aria-label="Marketing" className="mb-5">
      <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        {SECTIONS.map((section) => (
          <li key={section.key} className="shrink-0">
            <Link
              href={section.href}
              aria-current={section.key === current ? "page" : undefined}
              className={`bk-btn ${section.key === current ? "" : "bk-btn-quiet"}`}
            >
              <span className="cap-trim">{section.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A row of filter links: the stages of a list. */
export function FilterTabs({
  label,
  tabs,
  current,
}: {
  readonly label: string;
  readonly tabs: readonly {
    readonly key: string;
    readonly href: string;
    readonly label: string;
  }[];
  readonly current: string;
}) {
  return (
    <nav aria-label={label} className="mb-4">
      <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        {tabs.map((tab) => (
          <li key={tab.key} className="shrink-0">
            <Link
              href={tab.href}
              aria-current={tab.key === current ? "page" : undefined}
              className={`bk-btn ${tab.key === current ? "" : "bk-btn-quiet"}`}
            >
              <span className="cap-trim">{tab.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The line a form leaves behind: what happened, or why it did not. */
export function Flash({
  notice,
  tone,
}: {
  readonly notice?: string;
  readonly tone?: string;
}) {
  if (!notice) return null;
  return (
    <div className="mb-4">
      <Notice tone={tone === "bad" ? "bad" : "good"}>{notice}</Notice>
    </div>
  );
}

/** Shown in place of buttons to someone who may only look. */
export function LookOnly() {
  return (
    <p className="bk-muted leading-snug">
      Your account can look but not change things.
    </p>
  );
}

/* ---- pills -------------------------------------------------------------- */

const CAMPAIGN_TONE: Readonly<Record<CampaignStatus, PillTone>> = {
  draft: "plain",
  approved: "doing",
  sending: "todo",
  sent: "done",
  cancelled: "off",
};

export function CampaignPill({ status }: { readonly status: CampaignStatus }) {
  return <Pill tone={CAMPAIGN_TONE[status]}>{CAMPAIGN_LABEL[status]}</Pill>;
}

const SOCIAL_TONE: Readonly<Record<SocialStatus, PillTone>> = {
  idea: "plain",
  draft: "plain",
  approved: "doing",
  posted: "done",
  dropped: "off",
};

export function SocialPill({ status }: { readonly status: SocialStatus }) {
  return <Pill tone={SOCIAL_TONE[status]}>{SOCIAL_LABEL[status]}</Pill>;
}

const REVIEW_TONE: Readonly<Record<ReviewStatus, PillTone>> = {
  pending: "todo",
  published: "done",
  rejected: "off",
};

export function ReviewPill({ status }: { readonly status: ReviewStatus }) {
  return <Pill tone={REVIEW_TONE[status]}>{REVIEW_LABEL[status]}</Pill>;
}

const PARTNER_TONE: Readonly<Record<PartnerStatus, PillTone>> = {
  lead: "plain",
  talking: "doing",
  active: "done",
  paused: "off",
  no: "off",
};

export function PartnerPill({ status }: { readonly status: PartnerStatus }) {
  return (
    <Pill tone={PARTNER_TONE[status]}>{PARTNER_STATUS_LABEL[status]}</Pill>
  );
}

const PROMO_TONE: Readonly<Record<PromoState, PillTone>> = {
  live: "done",
  "not-started": "doing",
  finished: "off",
  "used-up": "off",
  off: "off",
};

export function PromoPill({ state }: { readonly state: PromoState }) {
  return <Pill tone={PROMO_TONE[state]}>{PROMO_STATE_LABEL[state]}</Pill>;
}

/** Whether a partner may be named where a customer can read it. */
export function PermissionPill({ onFile }: { readonly onFile: boolean }) {
  return onFile ? (
    <Pill tone="done">May be named</Pill>
  ) : (
    <Pill tone="todo">Do not name</Pill>
  );
}

/** What the copy check made of something, when it is worth saying. */
export function VerdictPill({ verdict }: { readonly verdict: CopyVerdict }) {
  if (verdict === "banned") return <Pill tone="todo">Copy check: stop</Pill>;
  if (verdict === "restricted") {
    return <Pill tone="doing">Copy check: have a look</Pill>;
  }
  return null;
}

/* ---- the copy check ------------------------------------------------------ */

export function CopyCheckResult({
  check,
  verdict,
  what,
}: {
  readonly check: CopyCheck | null;
  readonly verdict: CopyVerdict;
  /** "campaign", "caption", "review". */
  readonly what: string;
}) {
  if (check === null || verdict === "unchecked") {
    return (
      <p className="bk-muted leading-snug">
        Nothing to check yet. The copy rules are run over the {what} every time
        it is saved.
      </p>
    );
  }
  const when = formatNzDateTime(new Date(check.at));
  if (verdict === "clean") {
    return (
      <p className="leading-snug">
        Nothing found. Checked {when}. The check knows words, not meanings, so
        it still needs a person to read it.
      </p>
    );
  }
  return (
    <>
      <p className="leading-snug">
        {verdict === "banned"
          ? `This ${what} cannot go out as it is written.`
          : `This ${what} can go once somebody has read the points below and is happy with the wording.`}
      </p>
      <ul className="mt-4 flex flex-col gap-4">
        {check.findings.map((finding) => (
          <li key={`${finding.rule}-${finding.match}`}>
            <p className="flex flex-wrap items-center gap-2">
              <Pill tone={finding.severity === "banned" ? "todo" : "doing"}>
                {finding.severity === "banned" ? "Not allowed" : "Have a look"}
              </Pill>
              <span className="font-semibold [overflow-wrap:anywhere]">
                &ldquo;{finding.match}&rdquo;
              </span>
              <span className="bk-muted text-[0.9375rem]">
                rule {finding.rule}
              </span>
            </p>
            <p className="bk-muted mt-1.5 text-[0.9375rem] leading-snug">
              {finding.why}
            </p>
          </li>
        ))}
      </ul>
      <p className="bk-muted mt-4 text-[0.9375rem] leading-snug">
        Checked {when}. These are the same rules the site itself is held to.
      </p>
    </>
  );
}

/** The tick that says a person has read what a restricted rule picked out. */
export function ReadTheWarnings({
  id,
  rules,
}: {
  readonly id: string;
  readonly rules: readonly string[];
}) {
  if (rules.length === 0) return null;
  return (
    <label
      htmlFor={id}
      className="border-navy flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3"
    >
      <input
        id={id}
        type="checkbox"
        name="acknowledge"
        required
        className="accent-navy mt-0.5 size-6 shrink-0"
      />
      <span className="text-[0.9688rem] leading-snug">
        {`I have read what the copy check says (rule ${rules.join(", ")}) and the wording is right as it stands.`}
      </span>
    </label>
  );
}

/* ---- form fields --------------------------------------------------------- */

type FieldProps = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly hint?: ReactNode;
  readonly defaultValue?: string;
  readonly required?: boolean;
  readonly maxLength?: number;
  readonly placeholder?: string;
};

function Hint({ id, children }: { readonly id: string; children: ReactNode }) {
  return (
    <p id={id} className="bk-muted mt-1.5 text-[0.9375rem] leading-snug">
      {children}
    </p>
  );
}

export function TextField({
  id,
  name,
  label,
  hint,
  defaultValue,
  required,
  maxLength,
  placeholder,
  type = "text",
  inputMode,
  autoCapitalize,
  spellCheck,
  min,
  max,
}: FieldProps & {
  readonly type?: "text" | "url" | "email" | "tel" | "date" | "time" | "number";
  readonly inputMode?: "text" | "decimal" | "numeric" | "url" | "email" | "tel";
  readonly autoCapitalize?: "none" | "characters" | "sentences";
  readonly spellCheck?: boolean;
  readonly min?: number | string;
  readonly max?: number | string;
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        autoCapitalize={autoCapitalize}
        spellCheck={spellCheck}
        defaultValue={defaultValue}
        required={required}
        maxLength={maxLength}
        min={min}
        max={max}
        placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="field"
      />
      {hint ? <Hint id={`${id}-hint`}>{hint}</Hint> : null}
    </div>
  );
}

export function AreaField({
  id,
  name,
  label,
  hint,
  defaultValue,
  required,
  maxLength,
  placeholder,
  rows = 4,
  readOnly,
}: FieldProps & { readonly rows?: number; readonly readOnly?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        readOnly={readOnly}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="field"
      />
      {hint ? <Hint id={`${id}-hint`}>{hint}</Hint> : null}
    </div>
  );
}

export function SelectField({
  id,
  name,
  label,
  hint,
  defaultValue,
  options,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly hint?: ReactNode;
  readonly defaultValue?: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="field"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <Hint id={`${id}-hint`}>{hint}</Hint> : null}
    </div>
  );
}

/** A tick box with its label beside it and, if needed, a line under it. */
export function CheckField({
  id,
  name,
  label,
  hint,
  defaultChecked,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly hint?: ReactNode;
  readonly defaultChecked?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <input
          id={id}
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="accent-navy mt-0.5 size-6 shrink-0"
        />
        <span className="font-semibold leading-snug">{label}</span>
      </label>
      {hint ? <Hint id={`${id}-hint`}>{hint}</Hint> : null}
    </div>
  );
}

/**
 * A QR code, drawn on the page from its squares: one path, navy on white.
 * The same squares as the file the download gives.
 */
export function QrPreview({
  text,
  label,
  className = "",
}: {
  readonly text: string;
  /** What it is, for someone who cannot see it. */
  readonly label: string;
  readonly className?: string;
}) {
  const { d, side } = qrPath(qrMatrix(text));
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(side)} ${String(side)}`}
      shapeRendering="crispEdges"
      className={`border-navy-line rounded-lg border-2 bg-white ${className}`}
    >
      <path d={d} className="fill-navy" />
    </svg>
  );
}

/** A fold-away form: "Cancel this campaign", "Change the details". */
export function Fold({
  summary,
  danger = false,
  children,
}: {
  readonly summary: string;
  readonly danger?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <details>
      <summary
        className={`label inline-flex min-h-11 cursor-pointer items-center text-[1.05rem] ${danger ? "text-pink-deep" : ""}`}
      >
        <span className="cap-trim">{summary}</span>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/* ---- a campaign's body, as it will read ---------------------------------- */

function InlineNodes({
  nodes,
  siteUrl,
}: {
  readonly nodes: readonly Inline[];
  readonly siteUrl: string;
}) {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return <Fragment key={index}>{node.text}</Fragment>;
      case "strong":
        return (
          <strong key={index}>
            <InlineNodes nodes={node.children} siteUrl={siteUrl} />
          </strong>
        );
      case "em":
        return (
          <em key={index}>
            <InlineNodes nodes={node.children} siteUrl={siteUrl} />
          </em>
        );
      case "link":
        // Shown, not live: a preview should not lead anyone off the page.
        return (
          <Fragment key={index}>
            <span className="underline">
              <InlineNodes nodes={node.children} siteUrl={siteUrl} />
            </span>{" "}
            <span className="bk-muted text-[0.875rem] [overflow-wrap:anywhere]">
              (goes to {hrefFor(node.href, siteUrl)})
            </span>
          </Fragment>
        );
      case "break":
        return <br key={index} />;
    }
  });
}

/**
 * The parsed body, drawn with React. Nothing is pasted in as HTML: every
 * word is a text node, the same as in the email itself.
 */
export function MarkdownPreview({
  blocks,
  siteUrl,
}: {
  readonly blocks: readonly Block[];
  readonly siteUrl: string;
}) {
  return (
    <div className="flex flex-col gap-4 leading-relaxed [overflow-wrap:anywhere]">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "paragraph":
            return (
              <p key={index}>
                <InlineNodes nodes={block.children} siteUrl={siteUrl} />
              </p>
            );
          case "heading":
            return (
              <p
                key={index}
                className={`font-semibold ${block.level === 1 ? "text-[1.5rem]" : block.level === 2 ? "text-[1.25rem]" : "text-[1.0625rem]"} leading-tight`}
              >
                <InlineNodes nodes={block.children} siteUrl={siteUrl} />
              </p>
            );
          case "list": {
            const items = block.items.map((item, at) => (
              <li key={at}>
                <InlineNodes nodes={item} siteUrl={siteUrl} />
              </li>
            ));
            return block.ordered ? (
              <ol key={index} className="list-decimal pl-6">
                {items}
              </ol>
            ) : (
              <ul key={index} className="list-disc pl-6">
                {items}
              </ul>
            );
          }
          case "quote":
            return (
              <blockquote
                key={index}
                className="border-navy-line border-l-4 pl-4"
              >
                <InlineNodes nodes={block.children} siteUrl={siteUrl} />
              </blockquote>
            );
          case "rule":
            return <hr key={index} className="border-navy-line border-t-2" />;
        }
      })}
    </div>
  );
}
