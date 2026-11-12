import type { Metadata } from "next";
import Link from "next/link";

import { TestPill } from "@/components/backstage/orders";
import { Empty, Notice, PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import {
  COURIER_FILE_LIMIT,
  lastCourierUsed,
  ordersForCourier,
} from "@/lib/backstage/orders/courier";
import { KNOWN_COURIERS } from "@/lib/backstage/orders/couriers";
import { countOrders } from "@/lib/backstage/orders/ops";

import { TrackingBackForm } from "./forms";

export const metadata: Metadata = { title: "Courier" };

/**
 * The courier: packed orders out as one file for the courier's website, and
 * the tracking numbers it gives back in, which marks those orders shipped.
 * No courier's system is linked to. This is the typing saved.
 */
export default async function CourierPage({
  searchParams,
}: {
  searchParams: Promise<{
    which?: string;
    tests?: string;
    notice?: string;
    tone?: string;
  }>;
}) {
  await requireStaff();
  const params = await searchParams;
  const caller = await staffCaller();
  const which = params.which === "open" ? "open" : "packed";
  const includeTests = params.tests === "yes";

  const [waiting, counts, last] = await Promise.all([
    execute(ordersForCourier, { which, includeTests }, caller),
    execute(countOrders, {}, caller),
    execute(lastCourierUsed, {}, caller),
  ]);
  const said =
    waiting.length === 0
      ? which === "packed"
        ? "No packed orders are waiting for the courier."
        : "Nothing is waiting to be sent."
      : `${String(waiting.length)} order${waiting.length === 1 ? " is" : "s are"} ready for the courier.`;

  return (
    <>
      <PageHeader
        title="Courier"
        back={{ href: "/backstage/orders", label: "Orders" }}
        lead="Send the packed orders to the courier's website as one file, then paste the tracking numbers back to mark them shipped."
      />

      {params.notice ? (
        <div className="mb-4">
          <Notice tone={params.tone === "bad" ? "bad" : "good"}>
            {params.notice}
          </Notice>
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        <Panel title="1. Out: the file for the courier">
          <p
            className="text-[1.0625rem] font-semibold"
            data-testid="courier-waiting"
          >
            {said}
          </p>
          {counts.paid > 0 && which === "packed" ? (
            <p className="bk-muted mt-1 leading-snug">
              {String(counts.paid)} more {counts.paid === 1 ? "is" : "are"}{" "}
              still to pack, and {counts.paid === 1 ? "is" : "are"} not in the
              file.
            </p>
          ) : null}

          <form
            action="/backstage/orders/courier"
            method="get"
            className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3"
          >
            <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
              <legend className="field-label">Which orders</legend>
              <label className="inline-flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="which"
                  value="packed"
                  defaultChecked={which === "packed"}
                />
                Packed
              </label>
              <label className="inline-flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="which"
                  value="open"
                  defaultChecked={which === "open"}
                />
                Packed, and still to pack
              </label>
            </fieldset>
            <label className="inline-flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                name="tests"
                value="yes"
                defaultChecked={includeTests}
              />
              Test orders too
            </label>
            <button type="submit" className="bk-btn bk-btn-quiet">
              <span className="cap-trim">Show</span>
            </button>
          </form>

          {waiting.length === 0 ? (
            <Empty title="No file to make">
              When an order is packed it shows up here, ready to go to the
              courier.
            </Empty>
          ) : (
            <>
              <ul className="bk-rows mt-4">
                {waiting.map((order) => (
                  <li
                    key={order.number}
                    className="grid gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[9rem_1.3fr_1.6fr]"
                  >
                    <span className="flex flex-wrap items-center gap-2 font-semibold tabular-nums">
                      <Link
                        href={`/backstage/orders/${order.number}`}
                        className="underline decoration-2 underline-offset-4"
                      >
                        {order.number}
                      </Link>
                      <TestPill show={order.isTest} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{order.name}</span>
                      <span className="bk-muted block truncate text-[0.9375rem]">
                        {order.city} {order.postcode}
                        {order.rural ? " · rural" : ""}
                        {order.status === "paid" ? " · still to pack" : ""}
                      </span>
                    </span>
                    <span className="bk-muted min-w-0 text-[0.9375rem]">
                      {order.items}
                    </span>
                  </li>
                ))}
              </ul>
              <form
                action="/backstage/orders/courier/file"
                method="post"
                className="mt-4"
              >
                <input type="hidden" name="which" value={which} />
                <input
                  type="hidden"
                  name="tests"
                  value={includeTests ? "yes" : "no"}
                />
                <button type="submit" className="bk-btn">
                  <span className="cap-trim">
                    Download the file ({String(waiting.length)})
                  </span>
                </button>
              </form>
              {waiting.length === COURIER_FILE_LIMIT ? (
                <p className="bk-muted mt-2 leading-snug">
                  A file holds {String(COURIER_FILE_LIMIT)} orders at most, the
                  oldest first. Send these, then come back for the rest.
                </p>
              ) : null}
            </>
          )}

          <details className="mt-5">
            <summary className="min-h-11 cursor-pointer font-semibold">
              What is in the file, and what to do with it
            </summary>
            <div className="bk-muted mt-2 flex max-w-[44rem] flex-col gap-2 leading-snug">
              <p>
                A row for each order: its number, the name and address, the
                email and phone for the courier&apos;s messages, the note for
                the driver, and what is in the box. It opens in a spreadsheet.
              </p>
              <p>
                On the courier&apos;s website, look for loading orders from a
                file. The first time, it will ask which column is which. The
                columns use the names Starshipit lists for its own file, so
                there it should need no matching.
              </p>
              <p>
                There is no weight in it. Nobody has weighed a packed box yet,
                and a guess would be charged for, so set the size and weight on
                the courier&apos;s site.
              </p>
              <p>
                Making the file is written in the activity log, because it holds
                customers&apos; names and addresses. Delete it from your
                computer once the labels are printed.
              </p>
            </div>
          </details>
        </Panel>

        <Panel title="2. Back: the tracking numbers">
          <TrackingBackForm startWith={last ?? KNOWN_COURIERS[0]?.key ?? ""} />
        </Panel>
      </div>
    </>
  );
}
