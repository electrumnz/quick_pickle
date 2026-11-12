import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityList } from "@/components/backstage/ActivityList";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Empty, PageHeader, Panel, Pill } from "@/components/backstage/ui";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  getSupplier,
  listMaterials,
  listPurchaseOrders,
  type SupplierDetail,
} from "@/lib/backstage/stock/ops";
import { formatNzd } from "@/lib/shop/money";

import { supplierActiveAction, updateSupplierAction } from "../../actions";
import {
  count,
  DateText,
  Field,
  Fold,
  FormNotice,
  Hint,
  PurchaseStatusPill,
  TextArea,
} from "../../parts";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierPage({
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

  let supplier: SupplierDetail;
  try {
    supplier = await execute(
      getSupplier,
      { id: decodeURIComponent(id) },
      caller,
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
  const [materials, purchases, history] = await Promise.all([
    execute(listMaterials, { supplierId: supplier.id, limit: 200 }, caller),
    execute(listPurchaseOrders, { supplierId: supplier.id, limit: 50 }, caller),
    execute(
      listActivity,
      { entityType: "supplier", entityId: supplier.id, limit: 50 },
      caller,
    ),
  ]);
  const canWrite = staff.role !== "viewer";
  // Only ever a web link: anything else is shown as plain words.
  const website =
    supplier.website !== null && /^https?:\/\//i.test(supplier.website)
      ? supplier.website
      : null;

  return (
    <>
      <PageHeader
        title={supplier.name}
        back={{ href: "/backstage/stock/suppliers", label: "Suppliers" }}
        lead={supplier.supplies || undefined}
        actions={
          canWrite && supplier.active ? (
            <Link
              href={`/backstage/stock/purchase-orders/new?supplierId=${encodeURIComponent(supplier.id)}`}
              className="bk-btn"
            >
              <span className="cap-trim">Start a purchase order</span>
            </Link>
          ) : null
        }
      />
      {supplier.active ? null : (
        <p className="-mt-3 mb-5 flex flex-wrap items-center gap-2">
          <Pill tone="off">Not in use</Pill>
          <span className="leading-snug">
            Kept for the record. No new purchase orders can be started for them.
          </span>
        </p>
      )}
      <FormNotice notice={notice} tone={tone} />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Panel title="What they supply" flush>
            {materials.length === 0 ? (
              <Empty title="No materials yet">
                When a material is set as bought from this supplier, it shows up
                here.
              </Empty>
            ) : (
              <ul className="bk-rows">
                {materials.map((material) => (
                  <li key={material.id}>
                    <Link
                      href={`/backstage/stock/materials/${material.id}`}
                      className="bk-row grid-cols-[1fr_auto]"
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 font-semibold">
                          {material.name}
                          {material.low ? (
                            <Pill tone="todo">Reorder</Pill>
                          ) : null}
                        </span>
                        <span className="bk-muted block text-[0.9375rem]">
                          {material.unitCostCents === null
                            ? "Cost not known"
                            : `${formatNzd(material.unitCostCents)} ${material.unit === "each" ? "each" : `a ${material.unit}`}`}
                          {material.onOrder > 0
                            ? ` · ${count(material.onOrder)} on order`
                            : ""}
                        </span>
                      </span>
                      <span className="bk-num">
                        <span className="font-semibold">
                          {count(material.onHand)}
                        </span>{" "}
                        <span className="bk-muted text-[0.9375rem]">
                          on hand
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Purchase orders" flush>
            {purchases.length === 0 ? (
              <Empty title="None yet">
                Nothing has been ordered from them through here.
              </Empty>
            ) : (
              <ul className="bk-rows">
                {purchases.map((order) => (
                  <li key={order.id}>
                    <Link
                      href={`/backstage/stock/purchase-orders/${order.number}`}
                      className="bk-row grid-cols-[1fr_auto]"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold tabular-nums">
                          {order.number}
                        </span>
                        <span className="bk-muted block text-[0.9375rem]">
                          {count(order.lines)}{" "}
                          {order.lines === 1 ? "line" : "lines"},{" "}
                          {formatNzd(order.totalCents)}
                          {order.status === "sent" ? (
                            <>
                              {" · due "}
                              <DateText
                                date={order.expectedOn}
                                none="no date"
                              />
                            </>
                          ) : null}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center justify-end gap-1.5">
                        <PurchaseStatusPill
                          status={order.status}
                          overdue={order.overdue}
                        />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="History" flush>
            <ActivityList
              lines={history}
              now={now}
              empty="Nothing has been recorded for this supplier yet."
            />
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="How to reach them">
            <dl className="bk-kv">
              <dt>Contact</dt>
              <dd>
                {supplier.contactName || (
                  <span className="bk-muted">Nobody named</span>
                )}
              </dd>
              {supplier.email ? (
                <>
                  <dt>Email</dt>
                  <dd>
                    <a href={`mailto:${supplier.email}`} className="link">
                      {supplier.email}
                    </a>
                  </dd>
                </>
              ) : null}
              {supplier.phone ? (
                <>
                  <dt>Phone</dt>
                  <dd>
                    <a
                      href={`tel:${supplier.phone.replace(/\s/g, "")}`}
                      className="link"
                    >
                      {supplier.phone}
                    </a>
                  </dd>
                </>
              ) : null}
              {supplier.website ? (
                <>
                  <dt>Website</dt>
                  <dd>
                    {website ? (
                      <a
                        href={website}
                        className="link"
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {website
                          .replace(/^https?:\/\//i, "")
                          .replace(/\/$/, "")}
                      </a>
                    ) : (
                      supplier.website
                    )}
                  </dd>
                </>
              ) : null}
              <dt>Lead time</dt>
              <dd>
                {supplier.leadTimeDays === null ? (
                  <span className="bk-muted">Not known</span>
                ) : (
                  `${count(supplier.leadTimeDays)} working ${supplier.leadTimeDays === 1 ? "day" : "days"}`
                )}
              </dd>
              {supplier.notes ? (
                <>
                  <dt>Notes</dt>
                  <dd className="whitespace-pre-wrap">{supplier.notes}</dd>
                </>
              ) : null}
            </dl>

            {canWrite ? (
              <div className="mt-3 flex flex-col gap-1">
                <Fold summary="Change the details">
                  <form
                    action={updateSupplierAction}
                    className="mb-3 flex flex-col gap-3"
                  >
                    <input type="hidden" name="id" value={supplier.id} />
                    <Field
                      form="details"
                      name="name"
                      label="Name"
                      required
                      maxLength={120}
                      defaultValue={supplier.name}
                    />
                    <Field
                      form="details"
                      name="supplies"
                      label="What they supply"
                      maxLength={160}
                      defaultValue={supplier.supplies}
                    />
                    <Field
                      form="details"
                      name="contactName"
                      label="Who to talk to"
                      maxLength={80}
                      defaultValue={supplier.contactName}
                    />
                    <Field
                      form="details"
                      name="email"
                      label="Email"
                      kind="email"
                      maxLength={254}
                      defaultValue={supplier.email}
                    />
                    <Field
                      form="details"
                      name="phone"
                      label="Phone"
                      kind="tel"
                      maxLength={24}
                      defaultValue={supplier.phone}
                    />
                    <Field
                      form="details"
                      name="website"
                      label="Website"
                      kind="url"
                      maxLength={300}
                      defaultValue={supplier.website}
                    />
                    <Field
                      form="details"
                      name="leadTimeDays"
                      label="Lead time"
                      kind="count"
                      defaultValue={supplier.leadTimeDays}
                      hint="Working days from ordering to delivery. Leave it blank if you do not know."
                    />
                    <TextArea
                      form="details"
                      name="notes"
                      label="Notes"
                      maxLength={4000}
                      defaultValue={supplier.notes}
                    />
                    <SubmitButton
                      pending="Saving"
                      className="bk-btn bk-btn-quiet w-full"
                    >
                      Save
                    </SubmitButton>
                  </form>
                </Fold>
                <Fold
                  summary={
                    supplier.active
                      ? "Stop using this supplier"
                      : "Use this supplier again"
                  }
                >
                  <form
                    action={supplierActiveAction}
                    className="flex flex-col gap-3"
                  >
                    <input type="hidden" name="id" value={supplier.id} />
                    <input
                      type="hidden"
                      name="active"
                      value={supplier.active ? "false" : "true"}
                    />
                    <SubmitButton
                      pending="Saving"
                      className="bk-btn bk-btn-quiet w-full"
                    >
                      {supplier.active
                        ? "Mark as not in use"
                        : "Mark as in use"}
                    </SubmitButton>
                    <Hint>
                      {supplier.active
                        ? "They stay on record with their history. They drop off the usual list and cannot be given a new purchase order. Nobody is told."
                        : "They go back on the usual list and can be given purchase orders again."}
                    </Hint>
                  </form>
                </Fold>
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
    </>
  );
}
