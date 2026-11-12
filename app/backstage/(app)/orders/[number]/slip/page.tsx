import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { getOrder, type OrderDetail } from "@/lib/backstage/orders/ops";
import { formatNzDate } from "@/lib/time";

export const metadata: Metadata = { title: "Packing slip" };

/**
 * The packing slip: what goes in the box and where the box goes. Made to be
 * printed (the back end's navigation is hidden on paper) and to be read at
 * arm's length on a bench. No prices: a slip often travels in the box, and
 * the box may be a gift.
 */
export default async function SlipPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  await requireStaff();
  const { number: raw } = await params;

  let order: OrderDetail;
  try {
    order = await execute(
      getOrder,
      { number: decodeURIComponent(raw) },
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

  return (
    <div className="bk-slip mx-auto max-w-[44rem]">
      <p className="bk-noprint mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/backstage/orders/${order.number}`}
          className="label bk-muted inline-flex min-h-11 items-center text-[1.05rem]"
        >
          <span className="cap-trim">&larr; {order.number}</span>
        </Link>
        <span className="bk-muted text-[0.9375rem]">
          Print this page from your browser&apos;s menu.
        </span>
      </p>

      <article className="bk-panel bk-panel-pad">
        <header className="border-navy flex flex-wrap items-end justify-between gap-3 border-b-2 pb-4">
          <div>
            <p className="varsity text-[1.6rem] leading-none">Quick Pickle</p>
            <p className="label bk-muted mt-1 text-[1rem]">Packing slip</p>
          </div>
          <div className="text-right">
            <p className="varsity text-[2rem] leading-none tabular-nums">
              {order.number}
            </p>
            <p className="bk-muted mt-1 text-[0.9375rem]">
              Ordered {formatNzDate(order.placedAt)}
            </p>
          </div>
        </header>

        {order.isTest ? (
          <p className="bk-notice mt-4">
            Test order. Nobody was charged. Do not send it.
          </p>
        ) : null}

        <section className="mt-5">
          <h2 className="bk-h2">
            <span className="cap-trim">Send to</span>
          </h2>
          <p className="mt-2 text-[1.25rem] leading-snug">
            <span className="font-semibold">
              {order.firstName} {order.lastName}
            </span>
            <span className="block">{order.line1}</span>
            {order.line2 ? <span className="block">{order.line2}</span> : null}
            {order.suburb ? (
              <span className="block">{order.suburb}</span>
            ) : null}
            <span className="block">
              {order.city} {order.postcode}
            </span>
            <span className="block">{order.region}</span>
          </p>
          {order.rural ? (
            <p className="label mt-2 text-[1.1rem]">Rural delivery</p>
          ) : null}
          {order.phone ? (
            <p className="bk-muted mt-2">
              Phone for the courier: {order.phone}
            </p>
          ) : null}
          {order.deliveryNotes ? (
            <p className="mt-2">
              <span className="font-semibold">Note for the courier:</span>{" "}
              {order.deliveryNotes}
            </p>
          ) : null}
        </section>

        <section className="mt-6">
          <h2 className="bk-h2">
            <span className="cap-trim">In the box</span>
          </h2>
          <ul className="mt-2 flex flex-col">
            {order.lines.map((line) => (
              <li
                key={line.id}
                className="border-navy-line flex items-center gap-4 border-b py-3 text-[1.25rem]"
              >
                <span
                  aria-hidden="true"
                  className="border-navy size-7 shrink-0 rounded-md border-[3px]"
                />
                <span className="varsity w-12 text-[1.6rem] leading-none tabular-nums">
                  {line.qty}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{line.name}</span>
                  <span className="bk-muted block text-[0.9375rem]">
                    {line.shots} shots each, {line.qty * line.shots} in all
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[1.25rem]">
            <span className="font-semibold">{order.shots} shots</span> to pack
            altogether.
          </p>
        </section>
      </article>
    </div>
  );
}
