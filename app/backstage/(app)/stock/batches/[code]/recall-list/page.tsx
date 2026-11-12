import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderStatusPill } from "@/components/backstage/orders";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { formatDateKey } from "@/lib/backstage/stock/dates";
import {
  recallList,
  type RecallList,
  type RecallNoteLine,
  type RecallRow,
} from "@/lib/backstage/stock/ops";
import { BATCH_STATUS_LABEL } from "@/lib/backstage/stock/status";
import { formatNzDate, formatNzDateTime } from "@/lib/time";

import { count, FormNotice, shots } from "../../../parts";

export const metadata: Metadata = { title: "Recall list" };

function OrderBlock({ order }: { readonly order: RecallRow }) {
  return (
    <li className="border-navy-line border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="flex flex-wrap items-center gap-x-3">
          <Link
            href={`/backstage/orders/${order.number}`}
            className="link font-semibold tabular-nums"
          >
            {order.number}
          </Link>
          <span className="font-semibold">{shots(order.shots)}</span>
        </p>
        <OrderStatusPill status={order.status} />
      </div>
      <p className="text-[1.125rem] leading-snug">{order.name}</p>
      <p className="flex flex-wrap items-center gap-x-4 [overflow-wrap:anywhere]">
        <a href={`mailto:${order.email}`} className="link">
          {order.email}
        </a>
        {order.phone ? (
          <a href={`tel:${order.phone.replace(/\s/g, "")}`} className="link">
            {order.phone}
          </a>
        ) : null}
      </p>
      <p className="leading-snug">{order.address.join(", ")}</p>
      <p className="bk-muted mt-1 text-[0.9375rem]">
        Ordered {formatNzDate(order.placedAt)}
        {order.shippedAt ? `, shipped ${formatNzDate(order.shippedAt)}` : ""}
      </p>
    </li>
  );
}

/** "3 added", "2 taken off": what a count correction did. */
function changeText(change: number): string {
  return `${count(Math.abs(change))} ${change > 0 ? "added" : "taken off"}`;
}

/** What was written down each time shots moved with no order behind them. */
function Notes({
  lines,
  corrections = false,
}: {
  readonly lines: readonly RecallNoteLine[];
  readonly corrections?: boolean;
}) {
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {lines.map((line, index) => (
        <li
          key={`${line.at.toISOString()}:${String(index)}`}
          className="bk-muted text-[0.9375rem]"
        >
          {formatNzDate(line.at)}:{" "}
          {corrections ? changeText(line.shots) : count(line.shots)}.{" "}
          {line.note || "No note was made."}
        </li>
      ))}
    </ul>
  );
}

/**
 * Where every shot of the batch went, laid out so it can be seen to add up
 * to what was made.
 */
function Balance({ list }: { readonly list: RecallList }) {
  const { balance } = list;
  return (
    <section className="mt-6">
      <h2 className="bk-h2">
        <span className="cap-trim">Where every shot went</span>
      </h2>
      <dl className="bk-kv mt-2 max-w-[26rem]">
        <dt>Made</dt>
        <dd className="bk-num font-semibold">{count(balance.made)}</dd>
        {balance.adjustments === 0 ? null : (
          <>
            <dt>Count corrections</dt>
            <dd className="bk-num">{changeText(balance.adjustments)}</dd>
          </>
        )}
        <dt>Out on orders</dt>
        <dd className="bk-num">{count(balance.sold)}</dd>
        <dt>Given away as samples</dt>
        <dd className="bk-num">{count(balance.samples)}</dd>
        <dt>Written off</dt>
        <dd className="bk-num">{count(balance.waste)}</dd>
        <dt>Still on hand</dt>
        <dd className="bk-num">{count(balance.onHand)}</dd>
      </dl>
      {balance.addsUp ? (
        <p className="bk-muted mt-2 text-[0.9375rem] leading-snug">
          {balance.adjustments === 0
            ? "These add up to the number made, so every shot is accounted for."
            : "These add up to the number made once the count corrections are included. The reason for each correction is further down."}
        </p>
      ) : (
        <p className="bk-notice bk-notice-bad mt-3">
          These do not add up to the number made. Check this batch&apos;s
          history before relying on this list.
        </p>
      )}
    </section>
  );
}

/**
 * The recall list for one batch: every order that holds shots from it and
 * how to reach the customer, then where the rest of the batch went. Made to
 * be printed (the back end's navigation is hidden on paper) and to be worked
 * down, one customer at a time.
 */
export default async function RecallListPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  await requireStaff();
  const { code: raw } = await params;
  const { notice, tone } = await searchParams;

  let list: RecallList;
  try {
    list = await execute(
      recallList,
      { code: decodeURIComponent(raw) },
      await staffCaller(),
    );
  } catch (error) {
    if (
      error instanceof OpError &&
      (error.code === "not_found" || error.code === "invalid_input")
    ) {
      notFound();
    }
    throw error;
  }

  const { batch } = list;
  const sent = list.orders.filter((order) => order.sent);
  const here = list.orders.filter((order) => !order.sent);
  const emails = [...new Set(sent.map((order) => order.email))];
  const recalled = batch.status === "recalled";

  return (
    <div className="mx-auto max-w-[52rem]">
      <p className="bk-noprint mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/backstage/stock/batches/${batch.code}`}
          className="label bk-muted inline-flex min-h-11 items-center text-[1.05rem]"
        >
          <span className="cap-trim">&larr; {batch.code}</span>
        </Link>
        <span className="bk-muted text-[0.9375rem]">
          Print this page from your browser&apos;s menu.
        </span>
      </p>
      <div className="bk-noprint">
        <FormNotice notice={notice} tone={tone} />
      </div>

      <article className="bk-panel bk-panel-pad">
        <header className="border-navy flex flex-wrap items-end justify-between gap-3 border-b-2 pb-4">
          <div>
            <p className="varsity text-[1.6rem] leading-none">Quick Pickle</p>
            <p className="label bk-muted mt-1 text-[1rem]">Recall list</p>
          </div>
          <div className="text-right">
            <h1 className="varsity text-[2rem] leading-none tabular-nums">
              Batch {batch.code}
            </h1>
            <p className="bk-muted mt-1 text-[0.9375rem]">
              As at {formatNzDateTime(new Date())}
            </p>
          </div>
        </header>

        <p className="mt-4 leading-snug">
          {recalled ? (
            <>
              <span className="font-semibold">
                Recalled
                {batch.recall ? ` on ${formatDateKey(batch.recall.on)}` : ""}.
              </span>{" "}
              {batch.recall?.reason}
            </>
          ) : (
            <>
              <span className="font-semibold">
                This batch has not been recalled.
              </span>{" "}
              It is {BATCH_STATUS_LABEL[batch.status].toLowerCase()}. This is
              who has shots from it, should it ever need to be.
            </>
          )}
        </p>

        <dl className="bk-kv mt-4">
          <dt>Name</dt>
          <dd>{batch.name}</dd>
          <dt>Made on</dt>
          <dd>{batch.madeOn ? formatDateKey(batch.madeOn) : "Not recorded"}</dd>
          <dt>Best before</dt>
          <dd>
            {batch.bestBefore
              ? formatDateKey(batch.bestBefore)
              : "Not recorded"}
          </dd>
          <dt>Out on orders</dt>
          <dd>
            {shots(list.totals.shots)} on {count(list.totals.orders)}{" "}
            {list.totals.orders === 1 ? "order" : "orders"}
          </dd>
          <dt>Still on hand</dt>
          <dd>{shots(batch.onHand)}</dd>
        </dl>

        {list.complete ? null : (
          <p className="bk-notice bk-notice-bad mt-4">
            This list is cut short: there are {count(list.totals.orders)} orders
            and only the newest {count(list.orders.length)} are shown. Ask for
            the full list before relying on it.
          </p>
        )}

        <section className="mt-6">
          <h2 className="bk-h2">
            <span className="cap-trim">
              Sent to customers: {count(sent.length)}
            </span>
          </h2>
          {sent.length === 0 ? (
            <p className="bk-muted mt-2 leading-snug">
              No order with shots from this batch has been sent.
            </p>
          ) : (
            <>
              <p className="bk-muted mt-2 text-[0.9375rem] leading-snug">
                These boxes have left. Each customer has to be told.
              </p>
              <ul className="mt-1">
                {sent.map((order) => (
                  <OrderBlock key={order.number} order={order} />
                ))}
              </ul>
            </>
          )}
        </section>

        {here.length > 0 ? (
          <section className="mt-6">
            <h2 className="bk-h2">
              <span className="cap-trim">
                Packed and still here: {count(here.length)}
              </span>
            </h2>
            <p className="bk-muted mt-2 text-[0.9375rem] leading-snug">
              These boxes have not gone yet. Pull them: open each order and
              press &ldquo;Not packed after all&rdquo;, which puts its shots
              back on this batch&apos;s count.
            </p>
            <ul className="mt-1">
              {here.map((order) => (
                <OrderBlock key={order.number} order={order} />
              ))}
            </ul>
          </section>
        ) : null}

        <Balance list={list} />

        <section className="mt-6">
          <h2 className="bk-h2">
            <span className="cap-trim">Shots with no order behind them</span>
          </h2>
          <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 leading-snug">
            <li>
              {list.samples.shots === 0 ? (
                "No samples were given away from this batch."
              ) : (
                <>
                  {shots(list.samples.shots)}{" "}
                  {list.samples.shots === 1 ? "was" : "were"} given away as
                  samples. Nobody&apos;s details are held for them. The notes
                  made at the time:
                  <Notes lines={list.samples.notes} />
                </>
              )}
            </li>
            <li>
              {list.waste.shots === 0 ? (
                "Nothing from this batch was written off."
              ) : (
                <>
                  {shots(list.waste.shots)}{" "}
                  {list.waste.shots === 1 ? "was" : "were"} written off. The
                  notes made at the time:
                  <Notes lines={list.waste.notes} />
                </>
              )}
            </li>
            {list.corrections.notes.length > 0 ? (
              <li>
                The count was corrected{" "}
                {list.corrections.notes.length === 1
                  ? "once"
                  : `${count(list.corrections.notes.length)} times`}
                . The reason given each time:
                <Notes lines={list.corrections.notes} corrections />
              </li>
            ) : null}
          </ul>
        </section>

        <section className="mt-6">
          <h2 className="bk-h2">
            <span className="cap-trim">What this list cannot tell you</span>
          </h2>
          <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 leading-snug">
            <li>
              {list.noBatchRecorded === 0
                ? "Every order that has been packed or sent has a batch recorded, so no order is missing from this list for that reason."
                : `${count(list.noBatchRecorded)} ${list.noBatchRecorded === 1 ? "order has" : "orders have"} been packed or sent with no batch recorded at all. ${list.noBatchRecorded === 1 ? "It is" : "They are"} on no batch's list and could have had shots from this one.`}
              {list.noBatchRecorded > 0 ? (
                <>
                  {" "}
                  <Link
                    href="/backstage/stock#no-batch"
                    className="link bk-noprint"
                  >
                    See them
                  </Link>
                </>
              ) : null}
            </li>
            <li>
              This page contacts nobody. Who else has to be told about a recall,
              and how soon, is for your own recall procedure.
            </li>
            <li>
              Whether to run a practice recall each year is a question for MPI
              (the Ministry for Primary Industries). If you do, this is the list
              you would work from.
            </li>
          </ul>
        </section>
      </article>

      {emails.length > 0 ? (
        <div className="bk-noprint mt-6">
          <label htmlFor="recall-emails" className="field-label">
            Email addresses of the customers whose boxes were sent
          </label>
          <textarea
            id="recall-emails"
            readOnly
            rows={Math.min(6, Math.max(2, Math.ceil(emails.length / 2)))}
            value={emails.join(", ")}
            className="field font-mono"
          />
          <p className="bk-muted mt-1.5 text-[0.9375rem] leading-snug">
            To copy into your own email. Put them in the BCC line so customers
            do not see each other&apos;s addresses.
          </p>
        </div>
      ) : null}
    </div>
  );
}
