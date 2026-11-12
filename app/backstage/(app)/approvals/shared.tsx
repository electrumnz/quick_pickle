import Link from "next/link";

import { Pill, type PillTone } from "@/components/backstage/ui";
import type { ApprovalStatus } from "@/lib/backstage/connect/approvals";
import { ALL_OPS } from "@/lib/backstage/connect/catalogue";
import { formatNzdExact } from "@/lib/shop/money";

/** Where a request stands, as a word and a colour. */
const SAID: Readonly<
  Record<ApprovalStatus, { readonly word: string; readonly tone: PillTone }>
> = {
  waiting: { word: "Waiting", tone: "todo" },
  running: { word: "Being done", tone: "doing" },
  done: { word: "Done", tone: "done" },
  failed: { word: "Could not be done", tone: "off" },
  declined: { word: "You said no", tone: "off" },
  expired: { word: "Lapsed", tone: "off" },
};

export function StatusPill({ status }: { readonly status: ApprovalStatus }) {
  const said = SAID[status];
  return <Pill tone={said.tone}>{said.word}</Pill>;
}

/** What an operation is called on a screen: its title, or its name. */
export const titleOf = (operation: string): string =>
  ALL_OPS.get(operation)?.title ?? operation;

/** A field's name as words: "preorderShipsFrom" reads "preorder ships from". */
export const asWords = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();

/** The pages records have, by the first letters of their ids. */
const PAGES: Readonly<Record<string, string>> = {
  cus: "/backstage/customers",
  cnv: "/backstage/inbox",
  cmp: "/backstage/marketing/campaigns",
  lnk: "/backstage/marketing/links",
  pag: "/backstage/marketing/pages",
  prt: "/backstage/marketing/partners",
  pro: "/backstage/marketing/promo-codes",
  rev: "/backstage/marketing/reviews",
  pst: "/backstage/marketing/social",
  mat: "/backstage/stock/materials",
  sup: "/backstage/stock/suppliers",
};

/**
 * The page of the record a value names, if it names one: an order number,
 * a purchase order number, or the id of something that has a page. So that
 * a request to "send this campaign" can be one press from the campaign.
 */
export function recordHref(value: string): string | null {
  if (/^QP-[A-Z0-9]{6}$/.test(value)) return `/backstage/orders/${value}`;
  if (/^PO-\d{4,}$/.test(value)) {
    return `/backstage/stock/purchase-orders/${value}`;
  }
  const id = /^([a-z]{3})_[a-z0-9]{20}$/.exec(value);
  const page = id?.[1] === undefined ? undefined : PAGES[id[1]];
  return page === undefined ? null : `${page}/${value}`;
}

type Plain = string | number | boolean;

const isPlain = (value: unknown): value is Plain =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

/**
 * A plain value as a person reads it. An amount kept in cents is said in
 * dollars, with the cents beside it: 3000 on its own could be read as
 * three thousand dollars, and somebody is about to say yes to it.
 */
function PlainValue({
  name,
  value,
}: {
  readonly name: string;
  readonly value: Plain;
}) {
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  if (typeof value === "number") {
    return /cents$/i.test(name) && Number.isInteger(value) && value >= 0 ? (
      <>
        {formatNzdExact(value)}{" "}
        <span className="bk-muted">({String(value)} cents)</span>
      </>
    ) : (
      <>{String(value)}</>
    );
  }
  const href = recordHref(value);
  return href === null ? (
    <>{value}</>
  ) : (
    <>
      {value}{" "}
      <Link href={href} className="underline decoration-2 underline-offset-4">
        See it
      </Link>
    </>
  );
}

const isFlat = (value: unknown): value is Record<string, Plain | null> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((each) => each === null || isPlain(each));

/**
 * One thing that was handed over or came back, as a person reads it: words
 * as words, a list as a list, a few named things as a few lines. Anything
 * with more shape than that is folded away, because it is there to be
 * checked and not to be read.
 */
export function Shown({
  name,
  value,
}: {
  readonly name: string;
  readonly value: unknown;
}) {
  if (value === null || value === undefined) return <>Nothing</>;
  if (isPlain(value)) return <PlainValue name={name} value={value} />;
  if (Array.isArray(value) && value.every(isPlain)) {
    return value.length === 0 ? (
      <>None</>
    ) : (
      <ul className="list-disc pl-5">
        {value.map((each, index) => (
          <li key={index}>
            <PlainValue name={name} value={each} />
          </li>
        ))}
      </ul>
    );
  }
  if (isFlat(value)) {
    const entries = Object.entries(value);
    return entries.length === 0 ? (
      <>Nothing</>
    ) : (
      <ul className="list-disc pl-5">
        {entries.map(([key, each]) => (
          <li key={key}>
            {/* A key that is a name of its own (a pack's code) stays as it
                is written. A field's name is said as words. */}
            {/^[A-Z0-9-]+$/.test(key) ? key : asWords(key)}:{" "}
            {each === null ? (
              "nothing"
            ) : (
              // Inside a list of prices, every number is an amount.
              <PlainValue
                name={/price|cents/i.test(name) ? "cents" : key}
                value={each}
              />
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <details>
      <summary className="cursor-pointer underline decoration-2 underline-offset-4">
        Show all of it
      </summary>
      <pre className="mt-2 overflow-x-auto text-[0.875rem] leading-snug whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

/** What is plain first, so the part a person wants is at the top. */
export const plainFirst = (entries: [string, unknown][]) =>
  [...entries].sort(
    ([, a], [, b]) =>
      Number(isPlain(b) || isFlat(b) || Array.isArray(b)) -
      Number(isPlain(a) || isFlat(a) || Array.isArray(a)),
  );
