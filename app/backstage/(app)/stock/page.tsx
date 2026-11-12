import type { Metadata } from "next";
import Link from "next/link";

import { OrderStatusPill } from "@/components/backstage/orders";
import { Empty, PageHeader, Panel, Stat } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import {
  listOrdersWithoutBatch,
  stockPicture,
} from "@/lib/backstage/stock/ops";

import {
  BestBeforePill,
  bestBeforeText,
  count,
  FormNotice,
  shots,
} from "./parts";

export const metadata: Metadata = { title: "Stock" };

const SECTIONS = [
  {
    href: "/backstage/stock/batches",
    label: "Batches",
    blurb:
      "Each run of making: plan it, record it, release it, and recall it if you ever have to.",
  },
  {
    href: "/backstage/stock/materials",
    label: "Materials",
    blurb:
      "Bottles, caps, labels and cartons: what is on hand and what to reorder.",
  },
  {
    href: "/backstage/stock/suppliers",
    label: "Suppliers",
    blurb: "Who you buy from, and how long they take.",
  },
  {
    href: "/backstage/stock/purchase-orders",
    label: "Purchase orders",
    blurb: "What has been ordered, and whether it has arrived.",
  },
] as const;

/**
 * Stock: how many shots there are to sell right now and from which batches,
 * what needs a person, and the way in to batches, materials, suppliers and
 * purchase orders.
 */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { notice, tone } = await searchParams;
  const caller = await staffCaller();
  const picture = await execute(stockPicture, {}, caller);
  const unrecorded =
    picture.noBatchRecorded > 0
      ? await execute(listOrdersWithoutBatch, { limit: 20 }, caller)
      : [];
  const canWrite = staff.role !== "viewer";

  // The number that matters is what could still be sold: what is on hand
  // and in date, less what paid orders are already waiting for.
  const lead = !picture.tracking
    ? picture.planned > 0
      ? `${count(picture.planned)} ${picture.planned === 1 ? "batch is" : "batches are"} planned and none made yet. Shots are counted from the first batch you record as made.`
      : "Nothing has been made yet. Shots are counted from the first batch you record as made."
    : picture.promised === 0
      ? `${shots(picture.ready)} on hand and ready to sell.`
      : `${shots(picture.ready)} on hand and ready to sell. ${count(picture.promised)} of them ${picture.promised === 1 ? "is" : "are"} promised to orders waiting to be packed, which leaves ${count(picture.available)} free.`;

  return (
    <>
      <PageHeader title="Stock" lead={lead} />
      <FormNotice notice={notice} tone={tone} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Stat
          label="Free to sell"
          value={count(picture.available)}
          note={`${count(picture.ready)} on hand, less ${count(picture.promised)} promised`}
        />
        <Stat
          label="Promised"
          value={count(picture.promised)}
          note="To paid orders waiting to be packed"
        />
        <Stat
          label="Not released"
          value={count(picture.notReleased)}
          note={
            picture.waiting.length === 0
              ? "Nothing waiting"
              : "Made, waiting to be released"
          }
        />
        <Stat
          label="To reorder"
          value={count(picture.materialsToReorder.length)}
          note={
            picture.materialsToReorder.length === 0
              ? "No material is running low"
              : "Materials at their reorder level"
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Panel
            title="On sale, by batch"
            flush
            aside={
              <Link
                href="/backstage/stock/batches"
                className="link text-[0.9375rem]"
              >
                All batches
              </Link>
            }
          >
            {picture.byBatch.length === 0 ? (
              <>
                <Empty
                  title={
                    picture.tracking ? "Nothing released" : "Nothing made yet"
                  }
                >
                  {picture.tracking
                    ? "No batch is released for sale. An order packed now will have no batch recorded against it."
                    : "A batch is one run of making. Plan one, record it once it is made and release it, and its shots are counted here. Until then orders can still be packed: they just have no batch recorded."}
                </Empty>
                {canWrite && !picture.tracking && picture.planned === 0 ? (
                  <p className="-mt-4 pb-8 text-center">
                    <Link
                      href="/backstage/stock/batches/new"
                      className="bk-btn"
                    >
                      <span className="cap-trim">Plan the first batch</span>
                    </Link>
                  </p>
                ) : null}
              </>
            ) : (
              <ul className="bk-rows">
                {picture.byBatch.map((batch) => (
                  <li key={batch.id}>
                    <Link
                      href={`/backstage/stock/batches/${batch.code}`}
                      className="bk-row grid-cols-[1fr_auto]"
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 font-semibold">
                          {batch.code}
                          <BestBeforePill
                            days={
                              batch.onHand > 0 ? batch.daysToBestBefore : null
                            }
                            within={picture.nearDays}
                          />
                        </span>
                        <span className="bk-muted block text-[0.9375rem] leading-snug">
                          {batch.name}
                          {" · "}
                          {bestBeforeText(
                            batch.bestBefore,
                            batch.daysToBestBefore,
                          )}
                          {batch.good ? "" : ". Not for sale."}
                        </span>
                      </span>
                      <span className="bk-num">
                        <span className="font-semibold">
                          {count(batch.onHand)}
                        </span>{" "}
                        <span className="bk-muted text-[0.9375rem]">
                          {batch.onHand === 1 ? "shot" : "shots"}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {unrecorded.length > 0 ? (
            <Panel title="Orders with no batch recorded" flush>
              <div id="no-batch" className="scroll-mt-24">
                <p className="bk-muted px-4 pt-3 text-[0.9375rem] leading-snug">
                  These were packed or sent with no batch written against them,
                  so they are on no batch&apos;s recall list. Open one to record
                  its batch.
                </p>
                <ul className="bk-rows">
                  {unrecorded.map((order) => (
                    <li key={order.number}>
                      <Link
                        href={`/backstage/orders/${order.number}`}
                        className="bk-row grid-cols-[1fr_auto]"
                      >
                        <span className="min-w-0">
                          <span className="block font-semibold tabular-nums">
                            {order.number}
                          </span>
                          <span className="bk-muted block truncate text-[0.9375rem]">
                            {order.name} · {shots(order.shots)}
                          </span>
                        </span>
                        <OrderStatusPill status={order.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
                {picture.noBatchRecorded > unrecorded.length ? (
                  <p className="bk-muted border-navy-line border-t px-4 py-3 text-[0.9375rem]">
                    And {count(picture.noBatchRecorded - unrecorded.length)}{" "}
                    more.
                  </p>
                ) : null}
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Needs attention" flush>
            {picture.attention.length === 0 ? (
              <p className="bk-muted p-4 leading-snug">
                Nothing in stock needs you right now.
              </p>
            ) : (
              <ul className="bk-rows">
                {picture.attention.map((item) => (
                  <li key={`${item.kind}:${item.href}:${item.text}`}>
                    <Link href={item.href} className="bk-row grid-cols-1">
                      <span className="leading-snug">{item.text}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Everything in stock" flush>
            <ul className="bk-rows">
              {SECTIONS.map((section) => (
                <li key={section.href}>
                  <Link href={section.href} className="bk-row grid-cols-1">
                    <span className="bk-h2">
                      <span className="cap-trim">{section.label}</span>
                    </span>
                    <span className="bk-muted text-[0.9375rem] leading-snug">
                      {section.blurb}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
