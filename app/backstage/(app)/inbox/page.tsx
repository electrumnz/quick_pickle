import type { Metadata } from "next";
import Link from "next/link";

import {
  Empty,
  Notice,
  PageHeader,
  Panel,
  Pill,
  When,
} from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import {
  countConversations,
  getMailSetup,
  INBOX_TABS,
  listConversations,
  type ConversationSummary,
  type InboxTab,
} from "@/lib/backstage/mail/ops";
import { STATUS_LABEL } from "@/lib/backstage/mail/status";
import { backstageMode } from "@/lib/backstage/mode";

export const metadata: Metadata = { title: "Inbox" };

/**
 * The piles, in the order they are worked. A pile that only matters when
 * there is something in it (an email of ours that did not arrive, a
 * conversation put away until later) is left off the row until there is.
 */
const PILES: readonly {
  readonly key: InboxTab;
  readonly label: string;
  /** Shown beside the label: how much work is in it. */
  readonly counted: boolean;
  /** Left out while it is empty. */
  readonly whenAny?: boolean;
  readonly empty: string;
}[] = [
  {
    key: "needs-reply",
    label: "Needs a reply",
    counted: true,
    empty: "Nobody is waiting on you. When somebody writes, it shows up here.",
  },
  {
    key: "waiting",
    label: "Waiting on them",
    counted: true,
    empty: "Nothing you have answered is waiting on the other person.",
  },
  {
    key: "trouble",
    label: "Not delivered",
    counted: true,
    whenAny: true,
    empty: "Every email of ours has got where it was going.",
  },
  {
    key: "snoozed",
    label: "Put away",
    counted: true,
    whenAny: true,
    empty: "Nothing is put away until later.",
  },
  {
    key: "done",
    label: "Done",
    counted: false,
    empty: "Nothing is finished yet.",
  },
  {
    key: "notices",
    label: "Notices",
    counted: false,
    empty:
      "Emails a machine sent (a courier's update, a receipt) are kept here, out of the way.",
  },
  {
    key: "spam",
    label: "Spam",
    counted: false,
    empty: "No spam.",
  },
  { key: "all", label: "All", counted: false, empty: "No email yet." },
];

const days = (n: number) =>
  n === 1 ? "1 working day" : `${String(n)} working days`;

function Row({
  row,
  now,
  showStatus,
}: {
  readonly row: ConversationSummary;
  readonly now: Date;
  readonly showStatus: boolean;
}) {
  const who = row.contact?.name || row.contact?.email || "Unknown sender";
  const orders = row.links.filter((link) => link.entityType === "order");
  return (
    <li>
      <Link
        href={`/backstage/inbox/${row.id}`}
        className="bk-row grid-cols-[1fr_auto] md:grid-cols-[13rem_1fr_auto]"
      >
        <span className="min-w-0">
          <span className="block truncate font-semibold">{who}</span>
          {row.messageCount > 1 ? (
            <span className="bk-muted block text-[0.875rem]">
              {row.messageCount} messages
            </span>
          ) : null}
        </span>
        <span className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:row-auto">
          <span className="block truncate">
            {row.subject === "" ? "(no subject)" : row.subject}
          </span>
          <span className="bk-muted block truncate text-[0.9375rem]">
            {row.snippet}
          </span>
        </span>
        <span className="col-start-2 row-start-1 flex flex-col items-end gap-1 md:col-auto md:row-auto">
          <span className="bk-muted text-[0.875rem] whitespace-nowrap">
            <When at={row.lastMessageAt} now={now} />
          </span>
          <span className="flex flex-wrap justify-end gap-1">
            {row.trouble !== null ? (
              <Pill tone="todo">
                {row.trouble === "bounced" ? "Came back" : "Did not go"}
              </Pill>
            ) : null}
            {row.overdue && row.waitingDays !== null ? (
              <Pill tone="todo">{days(row.waitingDays)}</Pill>
            ) : null}
            {row.hasDraft ? <Pill tone="doing">Draft</Pill> : null}
            {row.snoozed ? <Pill tone="off">Put away</Pill> : null}
            {showStatus ? <Pill>{STATUS_LABEL[row.status]}</Pill> : null}
            {orders.slice(0, 2).map((link) => (
              <Pill key={link.label}>{link.label}</Pill>
            ))}
          </span>
        </span>
      </Link>
    </li>
  );
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    pile?: string;
    q?: string;
    notice?: string;
    tone?: string;
  }>;
}) {
  await requireStaff();
  const params = await searchParams;
  const caller = await staffCaller();
  const q = (params.q ?? "").trim().slice(0, 80);
  const asked = INBOX_TABS.find((tab) => tab === params.pile);
  // A search looks everywhere unless a pile was asked for by name.
  const pile: InboxTab = asked ?? (q === "" ? "needs-reply" : "all");
  const now = new Date();

  const [rows, counts, setup] = await Promise.all([
    execute(
      listConversations,
      { tab: pile, q: q === "" ? undefined : q, limit: 100 },
      caller,
    ),
    execute(countConversations, {}, caller),
    execute(getMailSetup, {}, caller),
  ]);
  const current = PILES.find((each) => each.key === pile);
  const shown = PILES.filter(
    (each) =>
      each.whenAny !== true ||
      each.key === pile ||
      (each.key !== "all" && counts[each.key] > 0),
  );
  const waiting = counts["needs-reply"];
  // Is anything bringing mail in? On invented records nothing is, and the
  // strip across the top already says what these are.
  const arrives =
    setup.resendWebhookSecret === "set" || setup.inboundSecret === "set";
  const demo = backstageMode() === "demo";

  return (
    <>
      <PageHeader
        title="Inbox"
        lead={
          waiting === 0
            ? "Nobody is waiting on a reply."
            : `${String(waiting)} waiting on a reply${counts.overdue > 0 ? `, ${String(counts.overdue)} of them for two working days or more` : ""}.`
        }
        actions={
          <Link
            href="/backstage/inbox/settings"
            className="bk-btn bk-btn-quiet"
          >
            <span className="cap-trim">Inbox settings</span>
          </Link>
        }
      />

      {params.notice ? (
        <div className="mb-4">
          <Notice tone={params.tone === "bad" ? "bad" : "good"}>
            {params.notice}
          </Notice>
        </div>
      ) : null}
      {!arrives && !demo ? (
        <div className="mb-4">
          <Notice>
            Mail does not arrive here by itself yet: nothing is set up to bring
            it in.{" "}
            <Link href="/backstage/inbox/settings" className="link">
              Inbox settings
            </Link>{" "}
            says what is missing.
          </Notice>
        </div>
      ) : null}

      <form
        action="/backstage/inbox"
        method="get"
        role="search"
        className="mb-4 flex flex-wrap items-end gap-2"
      >
        {asked === undefined ? null : (
          <input type="hidden" name="pile" value={pile} />
        )}
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="inbox-search" className="field-label">
            Find a conversation
          </label>
          <input
            id="inbox-search"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={80}
            placeholder="Name, address, subject or order number"
            className="field"
          />
        </div>
        <button type="submit" className="bk-btn">
          <span className="cap-trim">Search</span>
        </button>
      </form>

      <nav aria-label="Piles" className="mb-4">
        <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {shown.map((each) => {
            const here = each.key === pile;
            const href = `/backstage/inbox?pile=${each.key}${q === "" ? "" : `&q=${encodeURIComponent(q)}`}`;
            return (
              <li key={each.key} className="shrink-0">
                <Link
                  href={href}
                  aria-current={here ? "page" : undefined}
                  className={`bk-btn ${here ? "" : "bk-btn-quiet"}`}
                >
                  <span className="cap-trim">
                    {each.label}
                    {each.counted && each.key !== "all"
                      ? ` ${String(counts[each.key])}`
                      : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Panel flush>
        {rows.length === 0 ? (
          <Empty title={q === "" ? "Nothing here" : "No match"}>
            {q === ""
              ? (current?.empty ?? "")
              : `Nothing in ${current?.label ?? "this pile"} matches "${q}". Try All.`}
          </Empty>
        ) : (
          <ul className="bk-rows" data-testid="conversations">
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                now={now}
                showStatus={pile === "all"}
              />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
