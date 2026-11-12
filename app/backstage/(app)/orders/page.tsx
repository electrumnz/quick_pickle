import type { Metadata } from "next";
import Link from "next/link";

import { OrderStatusPill, TestPill } from "@/components/backstage/orders";
import {
  Empty,
  Notice,
  PageHeader,
  Panel,
  When,
} from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { countOrders, listOrders } from "@/lib/backstage/orders/ops";
import { formatNzd } from "@/lib/shop/money";

export const metadata: Metadata = { title: "Orders" };

const TABS = [
  { key: "paid", label: "To pack" },
  { key: "packed", label: "Packed" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
  { key: "pending", label: "Awaiting payment" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    notice?: string;
    tone?: string;
  }>;
}) {
  await requireStaff();
  const params = await searchParams;
  const caller = await staffCaller();
  const q = (params.q ?? "").trim();
  const status: TabKey =
    TABS.find((tab) => tab.key === params.status)?.key ??
    (q === "" ? "paid" : "all");
  const now = new Date();

  const [rows, counts] = await Promise.all([
    execute(
      listOrders,
      { status, q: q === "" ? undefined : q, limit: 100 },
      caller,
    ),
    execute(countOrders, {}, caller),
  ]);
  const total = Object.entries(counts)
    .filter(([key]) => key !== "open")
    .reduce((sum, [, n]) => sum + n, 0);
  const countFor = (key: TabKey) => (key === "all" ? total : counts[key]);

  return (
    <>
      <PageHeader
        title="Orders"
        lead={
          counts.paid === 0
            ? "Nothing waiting to be packed."
            : `${String(counts.paid)} to pack${counts.packed > 0 ? `, ${String(counts.packed)} packed and waiting for the courier` : ""}.`
        }
      />

      {params.notice ? (
        <div className="mb-4">
          <Notice tone={params.tone === "bad" ? "bad" : "good"}>
            {params.notice}
          </Notice>
        </div>
      ) : null}

      <form
        action="/backstage/orders"
        method="get"
        role="search"
        className="mb-4 flex flex-wrap items-end gap-2"
      >
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="order-search" className="field-label">
            Find an order
          </label>
          <input
            id="order-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Number, name, email or town"
            className="field"
          />
        </div>
        <button type="submit" className="bk-btn">
          <span className="cap-trim">Search</span>
        </button>
      </form>

      <nav aria-label="Order stages" className="mb-4">
        <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {TABS.map((tab) => {
            const current = tab.key === status;
            const href = `/backstage/orders?status=${tab.key}${q === "" ? "" : `&q=${encodeURIComponent(q)}`}`;
            return (
              <li key={tab.key} className="shrink-0">
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={`bk-btn ${current ? "" : "bk-btn-quiet"}`}
                >
                  <span className="cap-trim">
                    {tab.label} {countFor(tab.key)}
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
              ? status === "paid"
                ? "When someone orders, it shows up here to be packed."
                : "No orders at this stage."
              : `Nothing matches "${q}" at this stage. Try All.`}
          </Empty>
        ) : (
          <ul className="bk-rows">
            {rows.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/backstage/orders/${order.number}`}
                  className="bk-row grid-cols-[1fr_auto] md:grid-cols-[9rem_1.2fr_1.6fr_6rem_9rem]"
                >
                  <span className="flex flex-wrap items-center gap-2 font-semibold tabular-nums">
                    {order.number}
                    <TestPill show={order.isTest} />
                  </span>
                  <span className="row-start-2 min-w-0 md:row-auto">
                    <span className="block truncate">{order.name}</span>
                    <span className="bk-muted block truncate text-[0.9375rem]">
                      {order.city}
                      {order.rural ? " · rural" : ""}
                    </span>
                  </span>
                  <span className="bk-muted col-span-2 row-start-3 min-w-0 text-[0.9375rem] md:col-span-1 md:row-auto">
                    {order.items}
                  </span>
                  <span className="bk-num col-start-2 row-start-1 font-semibold md:col-auto md:row-auto">
                    {formatNzd(order.totalCents)}
                  </span>
                  <span className="col-start-2 row-start-2 flex flex-col items-end gap-1 md:col-auto md:row-auto">
                    <OrderStatusPill status={order.status} />
                    <span className="bk-muted text-[0.875rem] whitespace-nowrap">
                      <When at={order.placedAt} now={now} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
