import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Empty, PageHeader, Panel, Pill } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { listSuppliers } from "@/lib/backstage/stock/ops";

import { createSupplierAction } from "../actions";
import { count, Field, FormNotice, TextArea } from "../parts";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{
    show?: string;
    name?: string;
    supplies?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    website?: string;
    leadTimeDays?: string;
    notes?: string;
    notice?: string;
    tone?: string;
  }>;
}) {
  const staff = await requireStaff();
  const params = await searchParams;
  const all = await execute(
    listSuppliers,
    { show: "all", limit: 200 },
    await staffCaller(),
  );
  const unused = all.filter((supplier) => !supplier.active).length;
  const showAll = params.show === "all";
  const rows = showAll ? all : all.filter((supplier) => supplier.active);
  const canWrite = staff.role !== "viewer";

  return (
    <>
      <PageHeader
        title="Suppliers"
        back={{ href: "/backstage/stock", label: "Stock" }}
        lead="Who the bottles, caps, labels and cartons come from, and how long each takes."
        actions={
          unused > 0 ? (
            <Link
              href={
                showAll
                  ? "/backstage/stock/suppliers"
                  : "/backstage/stock/suppliers?show=all"
              }
              className="bk-btn bk-btn-quiet"
            >
              <span className="cap-trim">
                {showAll
                  ? "Hide the ones not in use"
                  : `Show ${count(unused)} not in use`}
              </span>
            </Link>
          ) : null
        }
      />
      <FormNotice notice={params.notice} tone={params.tone} />

      <Panel flush>
        {rows.length === 0 ? (
          <>
            <Empty
              title={all.length === 0 ? "No suppliers yet" : "None in use"}
            >
              {all.length === 0
                ? "Add the people you buy from. Then each material can say who supplies it, and a purchase order can be started for them."
                : "Every supplier on the list is marked as not in use."}
            </Empty>
            {canWrite && all.length === 0 ? (
              <p className="-mt-4 pb-8 text-center">
                <a href="#new" className="bk-btn">
                  <span className="cap-trim">Add the first supplier</span>
                </a>
              </p>
            ) : null}
          </>
        ) : (
          <ul className="bk-rows">
            {rows.map((supplier) => (
              <li key={supplier.id}>
                <Link
                  href={`/backstage/stock/suppliers/${supplier.id}`}
                  className="bk-row grid-cols-[1fr_auto]"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {supplier.name}
                      {supplier.active ? null : (
                        <Pill tone="off">Not in use</Pill>
                      )}
                    </span>
                    <span className="bk-muted block text-[0.9375rem] leading-snug">
                      {supplier.supplies ||
                        "Nothing noted about what they supply"}
                      {supplier.contactName ? ` · ${supplier.contactName}` : ""}
                    </span>
                  </span>
                  <span className="bk-muted flex flex-col items-end text-[0.9375rem] whitespace-nowrap">
                    <span>
                      {supplier.leadTimeDays === null
                        ? "Lead time not known"
                        : `${count(supplier.leadTimeDays)} working ${supplier.leadTimeDays === 1 ? "day" : "days"}`}
                    </span>
                    {supplier.openPurchases > 0 ? (
                      <span>
                        {count(supplier.openPurchases)} open{" "}
                        {supplier.openPurchases === 1 ? "order" : "orders"}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canWrite ? (
        <Panel title="Add a supplier" className="mt-6 max-w-[40rem]">
          <form
            id="new"
            action={createSupplierAction}
            className="flex scroll-mt-24 flex-col gap-4"
          >
            <Field
              form="supplier"
              name="name"
              label="Name"
              required
              maxLength={120}
              defaultValue={params.name}
            />
            <Field
              form="supplier"
              name="supplies"
              label="What they supply"
              maxLength={160}
              defaultValue={params.supplies}
              placeholder="Bottles and caps"
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                form="supplier"
                name="contactName"
                label="Who to talk to"
                maxLength={80}
                defaultValue={params.contactName}
              />
              <Field
                form="supplier"
                name="email"
                label="Email"
                kind="email"
                maxLength={254}
                defaultValue={params.email}
              />
              <Field
                form="supplier"
                name="phone"
                label="Phone"
                kind="tel"
                maxLength={24}
                defaultValue={params.phone}
              />
              <Field
                form="supplier"
                name="website"
                label="Website"
                kind="url"
                maxLength={300}
                defaultValue={params.website}
              />
              <Field
                form="supplier"
                name="leadTimeDays"
                label="Lead time"
                kind="count"
                defaultValue={params.leadTimeDays}
                hint="Working days from ordering to delivery, if you know."
              />
            </div>
            <TextArea
              form="supplier"
              name="notes"
              label="Notes"
              maxLength={4000}
              rows={2}
              defaultValue={params.notes}
            />
            <SubmitButton pending="Adding" className="bk-btn w-full">
              Add the supplier
            </SubmitButton>
          </form>
        </Panel>
      ) : null}
    </>
  );
}
