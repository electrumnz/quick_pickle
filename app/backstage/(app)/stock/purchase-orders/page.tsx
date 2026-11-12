import type { Metadata } from "next";
import Link from "next/link";

import { Empty, PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { listPurchaseOrders } from "@/lib/backstage/stock/ops";
import { formatNzd } from "@/lib/shop/money";

import { count, DateText, FormNotice, PurchaseStatusPill } from "../parts";

export const metadata: Metadata = { title: "Purchase orders" };

const TABS = [
  { key: "open", label: "Open" },
  { key: "draft", label: "Drafts" },
  { key: "sent", label: "Sent" },
  { key: "received", label: "Received" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const params = await searchParams;
  const status: TabKey =
    TABS.find((tab) => tab.key === params.status)?.key ?? "open";
  // Newest 200: plenty for the tabs and their counts to come from one list.
  const all = await execute(
    listPurchaseOrders,
    { limit: 200 },
    await staffCaller(),
  );
  const matches = (key: TabKey) =>
    all.filter((order) =>
      key === "all"
        ? true
        : key === "open"
          ? order.status === "draft" || order.status === "sent"
          : order.status === key,
    );
  const rows = matches(status);
  const overdue = all.filter((order) => order.overdue).length;
  const canWrite = staff.role !== "viewer";

  return (
    <>
      <PageHeader
        title="Purchase orders"
        back={{ href: "/backstage/stock", label: "Stock" }}
        lead={
          all.length === 0
            ? "What you have ordered from suppliers, and whether it has arrived."
            : overdue === 0
              ? "Nothing is overdue."
              : `${count(overdue)} ${overdue === 1 ? "is" : "are"} past the day ${overdue === 1 ? "it was" : "they were"} due.`
        }
        actions={
          canWrite && all.length > 0 ? (
            <Link
              href="/backstage/stock/purchase-orders/new"
              className="bk-btn"
            >
              <span className="cap-trim">New purchase order</span>
            </Link>
          ) : null
        }
      />
      <FormNotice notice={params.notice} tone={params.tone} />

      {all.length === 0 ? (
        <Panel flush>
          <Empty title="No purchase orders yet">
            Start one when you order from a supplier. Mark it sent, then mark it
            received when the goods turn up, and the counts of your materials go
            up by themselves.
          </Empty>
          {canWrite ? (
            <p className="-mt-4 pb-8 text-center">
              <Link
                href="/backstage/stock/purchase-orders/new"
                className="bk-btn"
              >
                <span className="cap-trim">Start the first one</span>
              </Link>
            </p>
          ) : null}
        </Panel>
      ) : (
        <>
          <nav aria-label="Purchase order states" className="mb-4">
            <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
              {TABS.map((tab) => {
                const current = tab.key === status;
                return (
                  <li key={tab.key} className="shrink-0">
                    <Link
                      href={`/backstage/stock/purchase-orders?status=${tab.key}`}
                      aria-current={current ? "page" : undefined}
                      className={`bk-btn ${current ? "" : "bk-btn-quiet"}`}
                    >
                      <span className="cap-trim">
                        {tab.label} {matches(tab.key).length}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <Panel flush>
            {rows.length === 0 ? (
              <Empty title="Nothing here">
                {status === "open"
                  ? "No purchase order is waiting on you or on a supplier."
                  : "No purchase orders in this state."}
              </Empty>
            ) : (
              <ul className="bk-rows">
                {rows.map((order) => (
                  <li key={order.id}>
                    <Link
                      href={`/backstage/stock/purchase-orders/${order.number}`}
                      className="bk-row grid-cols-[1fr_auto]"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold tabular-nums">
                          {order.number}
                        </span>
                        <span className="block truncate">
                          {order.supplierName}
                        </span>
                        <span className="bk-muted block text-[0.9375rem]">
                          {order.status === "received" ? (
                            <>
                              Arrived <DateText date={order.receivedOn} />
                            </>
                          ) : order.status === "sent" ? (
                            <>
                              Due{" "}
                              <DateText
                                date={order.expectedOn}
                                none="date not set"
                              />
                            </>
                          ) : order.status === "draft" ? (
                            "Not sent yet"
                          ) : (
                            "Called off"
                          )}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <span className="bk-num font-semibold">
                          {formatNzd(order.totalCents)}
                        </span>
                        <span className="flex flex-wrap justify-end gap-1.5">
                          <PurchaseStatusPill
                            status={order.status}
                            overdue={order.overdue}
                          />
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
