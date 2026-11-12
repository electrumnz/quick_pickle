import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderStatusPill, TestPill } from "@/components/backstage/orders";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import {
  Empty,
  Notice,
  PageHeader,
  Panel,
  Pill,
  Stat,
  When,
} from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  getCustomer,
  type CustomerDetail,
} from "@/lib/backstage/customers/ops";
import { listOrders } from "@/lib/backstage/orders/ops";
import { formatNzd } from "@/lib/shop/money";
import { formatNzDate } from "@/lib/time";

import { updateCustomerAction } from "../actions";

export const metadata: Metadata = { title: "Customer" };

const CREW_LABEL = {
  subscribed: "On the Pickle Crew list",
  unsubscribed: "Left the Pickle Crew list",
  bounced: "Email bounced",
  complained: "Marked us as spam",
} as const;

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const { notice, tone } = await searchParams;
  const caller = await staffCaller();
  const now = new Date();

  let customer: CustomerDetail;
  try {
    customer = await execute(
      getCustomer,
      { id: decodeURIComponent(id) },
      caller,
    );
  } catch (error) {
    if (error instanceof OpError && error.code === "not_found") notFound();
    throw error;
  }
  const orders = await execute(
    listOrders,
    { customerId: customer.id, limit: 100 },
    caller,
  );
  const canWrite = staff.role !== "viewer";
  const [firstName = "", ...rest] = customer.name.split(" ");

  return (
    <>
      <PageHeader
        title={customer.name || customer.email}
        back={{ href: "/backstage/customers", label: "Customers" }}
        lead={
          <>
            <a href={`mailto:${customer.email}`} className="link">
              {customer.email}
            </a>
            {customer.phone ? ` · ${customer.phone}` : ""}
          </>
        }
      />

      {notice ? (
        <div className="mb-4">
          <Notice tone={tone === "bad" ? "bad" : "good"}>{notice}</Notice>
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 [&>*]:min-w-0">
        <Stat label="Orders" value={customer.orders} />
        <Stat
          label="Spent"
          value={formatNzd(customer.spentCents)}
          note="Paid orders, less refunds"
        />
        <Stat
          label="Customer since"
          value={
            <span className="text-[1.25rem]">
              {formatNzDate(customer.createdAt)}
            </span>
          }
        />
        <Stat
          label="Pickle Crew"
          value={
            <span className="text-[1.25rem]">
              {customer.crew === "subscribed" ? "Yes" : "No"}
            </span>
          }
          note={customer.crew ? CREW_LABEL[customer.crew] : "Never joined"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
        <Panel title="Orders" flush>
          {orders.length === 0 ? (
            <Empty title="No orders">
              On the list, but has not ordered yet.
            </Empty>
          ) : (
            <ul className="bk-rows">
              {orders.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/backstage/orders/${order.number}`}
                    className="bk-row grid-cols-[1fr_auto]"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 font-semibold tabular-nums">
                        {order.number}
                        <TestPill show={order.isTest} />
                      </span>
                      <span className="bk-muted block text-[0.9375rem]">
                        {order.items}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className="bk-num font-semibold">
                        {formatNzd(order.totalCents)}
                      </span>
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

        <Panel title="About them">
          {canWrite ? (
            <form action={updateCustomerAction} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={customer.id} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="firstName" className="field-label">
                    First name
                  </label>
                  <input
                    id="firstName"
                    name="firstName"
                    defaultValue={firstName}
                    className="field"
                  />
                </div>
                <div>
                  <label htmlFor="lastName" className="field-label">
                    Last name
                  </label>
                  <input
                    id="lastName"
                    name="lastName"
                    defaultValue={rest.join(" ")}
                    className="field"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="phone" className="field-label">
                  Phone
                </label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  defaultValue={customer.phone ?? ""}
                  className="field"
                />
              </div>
              <div>
                <label htmlFor="tags" className="field-label">
                  Tags
                </label>
                <input
                  id="tags"
                  name="tags"
                  defaultValue={customer.tags.join(", ")}
                  aria-describedby="tags-hint"
                  className="field"
                />
                <p
                  id="tags-hint"
                  className="bk-muted mt-1.5 text-[0.9375rem] leading-snug"
                >
                  Plain words with commas between: club captain, wholesale lead.
                </p>
              </div>
              <div>
                <label htmlFor="notes" className="field-label">
                  Notes
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={5}
                  defaultValue={customer.notes}
                  aria-describedby="notes-hint"
                  className="field"
                />
                <p
                  id="notes-hint"
                  className="bk-muted mt-1.5 text-[0.9375rem] leading-snug"
                >
                  For staff only. The customer never sees this.
                </p>
              </div>
              <SubmitButton pending="Saving">Save</SubmitButton>
            </form>
          ) : (
            <>
              <p className="flex flex-wrap gap-1.5">
                {customer.tags.map((tag) => (
                  <Pill key={tag}>{tag}</Pill>
                ))}
              </p>
              <p className="mt-3 leading-snug whitespace-pre-wrap">
                {customer.notes || "No notes."}
              </p>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
