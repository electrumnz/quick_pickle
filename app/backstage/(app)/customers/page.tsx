import type { Metadata } from "next";
import Link from "next/link";

import {
  Empty,
  PageHeader,
  Panel,
  Pill,
  When,
} from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { countCrew } from "@/lib/backstage/crew/ops";
import { listCustomers } from "@/lib/backstage/customers/ops";
import { formatNzd } from "@/lib/shop/money";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireStaff();
  const q = ((await searchParams).q ?? "").trim();
  const caller = await staffCaller();
  const now = new Date();
  const [rows, crew] = await Promise.all([
    execute(listCustomers, { q: q === "" ? undefined : q, limit: 100 }, caller),
    execute(countCrew, {}, caller),
  ]);

  return (
    <>
      <PageHeader
        title="Customers"
        lead={`Everyone who has ordered. ${String(crew.subscribed)} ${crew.subscribed === 1 ? "person is" : "people are"} on the Pickle Crew list.`}
      />

      <form
        action="/backstage/customers"
        method="get"
        role="search"
        className="mb-4 flex flex-wrap items-end gap-2"
      >
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="customer-search" className="field-label">
            Find a customer
          </label>
          <input
            id="customer-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Name, email or tag"
            className="field"
          />
        </div>
        <button type="submit" className="bk-btn">
          <span className="cap-trim">Search</span>
        </button>
      </form>

      <Panel flush>
        {rows.length === 0 ? (
          <Empty title={q === "" ? "Nobody yet" : "No match"}>
            {q === ""
              ? "The first order makes the first customer."
              : `Nobody matches "${q}".`}
          </Empty>
        ) : (
          <ul className="bk-rows">
            {rows.map((customer) => (
              <li key={customer.id}>
                <Link
                  href={`/backstage/customers/${customer.id}`}
                  className="bk-row grid-cols-[1fr_auto] md:grid-cols-[1.4fr_1.2fr_5rem_6rem_9rem]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {customer.name || customer.email}
                    </span>
                    <span className="bk-muted block truncate text-[0.9375rem]">
                      {customer.email}
                    </span>
                  </span>
                  <span className="col-span-2 row-start-2 flex flex-wrap gap-1.5 md:col-span-1 md:row-auto">
                    {customer.tags.map((tag) => (
                      <Pill key={tag}>{tag}</Pill>
                    ))}
                  </span>
                  <span className="bk-num bk-muted hidden md:block">
                    {customer.orders}{" "}
                    {customer.orders === 1 ? "order" : "orders"}
                  </span>
                  <span className="bk-num col-start-2 row-start-1 font-semibold md:col-auto md:row-auto">
                    {formatNzd(customer.spentCents)}
                  </span>
                  <span className="bk-muted hidden text-right text-[0.9375rem] whitespace-nowrap md:block">
                    {customer.lastOrderAt ? (
                      <When at={customer.lastOrderAt} now={now} />
                    ) : (
                      "no orders"
                    )}
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
