import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityList } from "@/components/backstage/ActivityList";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import {
  Empty,
  PageHeader,
  Panel,
  Pill,
  Stat,
} from "@/components/backstage/ui";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  getMaterial,
  listPurchaseOrders,
  listSuppliers,
  type MaterialDetail,
} from "@/lib/backstage/stock/ops";
import { formatNzd } from "@/lib/shop/money";

import { countMaterialAction, updateMaterialAction } from "../../actions";
import {
  Choice,
  count,
  DateText,
  dollars,
  Field,
  Fold,
  FormNotice,
  Hint,
  LookOnly,
  PurchaseStatusPill,
  TextArea,
} from "../../parts";

export const metadata: Metadata = { title: "Material" };

export default async function MaterialPage({
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

  let material: MaterialDetail;
  try {
    material = await execute(
      getMaterial,
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
  const [history, purchases, suppliers] = await Promise.all([
    execute(
      listActivity,
      { entityType: "material", entityId: material.id, limit: 100 },
      caller,
    ),
    execute(listPurchaseOrders, { materialId: material.id, limit: 20 }, caller),
    execute(listSuppliers, { show: "all", limit: 200 }, caller),
  ]);
  const canWrite = staff.role !== "viewer";
  // Suppliers still in use, plus the one this is bought from even if not.
  const choices = suppliers.filter(
    (supplier) => supplier.active || supplier.id === material.supplierId,
  );

  return (
    <>
      <PageHeader
        title={material.name}
        back={{ href: "/backstage/stock/materials", label: "Materials" }}
        lead={
          <>
            {material.supplierId && material.supplierName ? (
              <>
                Bought from{" "}
                <Link
                  href={`/backstage/stock/suppliers/${material.supplierId}`}
                  className="link"
                >
                  {material.supplierName}
                </Link>
                .
              </>
            ) : (
              "No supplier set."
            )}
            {material.unit === "each"
              ? ""
              : ` Counted by the ${material.unit}.`}
          </>
        }
      />
      {material.low ? (
        <p className="-mt-3 mb-5 flex flex-wrap items-center gap-2">
          <Pill tone="todo">Reorder</Pill>
          <span className="leading-snug">
            {material.onOrder > 0
              ? `At its reorder level, with ${count(material.onOrder)} already on order.`
              : "At its reorder level, and none on order."}
          </span>
        </p>
      ) : null}
      <FormNotice notice={notice} tone={tone} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Stat label="On hand" value={count(material.onHand)} />
        <Stat
          label="On order"
          value={count(material.onOrder)}
          note="On purchase orders sent and not yet in"
        />
        <Stat
          label="Reorder at"
          value={
            material.reorderAt === null ? (
              <span className="text-[1.25rem]">Not set</span>
            ) : (
              count(material.reorderAt)
            )
          }
        />
        <Stat
          label="One costs"
          value={
            <span className="text-[1.25rem]">
              {material.unitCostCents === null
                ? "Not known"
                : formatNzd(material.unitCostCents)}
            </span>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Panel title="Count on hand">
            {canWrite ? (
              <form
                action={countMaterialAction}
                className="flex max-w-[32rem] flex-col gap-3"
              >
                <input type="hidden" name="id" value={material.id} />
                {/* What the screen showed when the count was made: only the
                    difference from it is applied. */}
                <input
                  type="hidden"
                  name="expected"
                  value={material.onHand}
                />
                <Field
                  form="count"
                  name="counted"
                  label="How many are there now"
                  kind="count"
                  required
                  hint={`The screen says ${count(material.onHand)}. Type what you counted: only the difference is recorded, with your reason.`}
                />
                <Field
                  form="count"
                  name="reason"
                  label="Why it changed"
                  required
                  maxLength={280}
                  placeholder="Used on the last run"
                />
                <SubmitButton pending="Saving" className="bk-btn w-full">
                  Save the count
                </SubmitButton>
                <Hint>
                  Stock that arrives on a purchase order is added when you mark
                  the order as received, not here.
                </Hint>
              </form>
            ) : (
              <LookOnly />
            )}
          </Panel>

          <Panel title="Purchase orders" flush>
            {purchases.length === 0 ? (
              <Empty title="None yet">
                Purchase orders with this material on them show up here.
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
                        <span className="bk-muted block truncate text-[0.9375rem]">
                          {order.supplierName}
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
              empty="Nothing has been recorded for this material yet."
            />
          </Panel>
        </div>

        <Panel title="Details">
          {material.notes ? (
            <p className="mb-3 leading-snug whitespace-pre-wrap">
              {material.notes}
            </p>
          ) : (
            <p className="bk-muted mb-3 leading-snug">No notes.</p>
          )}
          {canWrite ? (
            <Fold summary="Change the details">
              <form
                action={updateMaterialAction}
                className="flex flex-col gap-3"
              >
                <input type="hidden" name="id" value={material.id} />
                <Field
                  form="details"
                  name="name"
                  label="What it is"
                  required
                  maxLength={120}
                  defaultValue={material.name}
                />
                <Field
                  form="details"
                  name="unit"
                  label="Counted by the"
                  required
                  maxLength={20}
                  defaultValue={material.unit}
                />
                <Choice
                  form="details"
                  name="supplierId"
                  label="Bought from"
                  defaultValue={material.supplierId}
                  options={[
                    { value: "", label: "Not set" },
                    ...choices.map((supplier) => ({
                      value: supplier.id,
                      label: supplier.active
                        ? supplier.name
                        : `${supplier.name} (not in use)`,
                    })),
                  ]}
                />
                <Field
                  form="details"
                  name="reorderAt"
                  label="Reorder at"
                  kind="count"
                  defaultValue={material.reorderAt}
                  hint="Leave it blank for no flag."
                />
                <Field
                  form="details"
                  name="unitCost"
                  label="What one costs"
                  kind="money"
                  defaultValue={dollars(material.unitCostCents)}
                  hint="In dollars. Leave it blank if you do not know."
                />
                <TextArea
                  form="details"
                  name="notes"
                  label="Notes"
                  maxLength={4000}
                  defaultValue={material.notes}
                />
                <SubmitButton
                  pending="Saving"
                  className="bk-btn bk-btn-quiet w-full"
                >
                  Save
                </SubmitButton>
              </form>
            </Fold>
          ) : null}
        </Panel>
      </div>
    </>
  );
}
