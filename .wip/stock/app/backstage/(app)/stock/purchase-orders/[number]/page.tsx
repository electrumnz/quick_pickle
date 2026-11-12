import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityList } from "@/components/backstage/ActivityList";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import { PageHeader, Panel } from "@/components/backstage/ui";
import { STORE } from "@/content/offer";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { formatDateKey } from "@/lib/backstage/stock/dates";
import {
  getPurchaseOrder,
  listMaterials,
  type PurchaseDetail,
} from "@/lib/backstage/stock/ops";
import { ACCEPTED_FIELD } from "@/lib/backstage/stock/purchasing";
import { formatNzdExact } from "@/lib/shop/money";
import { nzDateKey } from "@/lib/time";

import {
  addLineAction,
  cancelPurchaseAction,
  purchaseReceivedAction,
  purchaseSentAction,
  removeLineAction,
  updatePurchaseAction,
} from "../../actions";
import {
  Choice,
  count,
  Field,
  Fold,
  FormNotice,
  Hint,
  LookOnly,
  PurchaseStatusPill,
  TextArea,
} from "../../parts";

type Params = { number: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  return { title: decodeURIComponent((await params).number).toUpperCase() };
}

function Number({ value }: { readonly value: string }) {
  return <input type="hidden" name="number" value={value} />;
}

function CancelForm({ order }: { readonly order: PurchaseDetail }) {
  return (
    <Fold summary="Cancel this order" warn>
      <form action={cancelPurchaseAction} className="flex flex-col gap-3">
        <Number value={order.number} />
        <Field form="cancel" name="reason" label="Why" maxLength={280} />
        <SubmitButton
          pending="Cancelling"
          className="bk-btn bk-btn-pink w-full"
        >
          Cancel the order
        </SubmitButton>
        <Hint>
          {order.status === "sent"
            ? "This does not tell the supplier. They already have the order, so let them know yourself."
            : "It stays on the list as cancelled. No count changes."}
        </Hint>
      </form>
    </Fold>
  );
}

/** What to do with this order now. Only what its state allows is offered. */
function NextStep({
  order,
  canWrite,
  today,
}: {
  readonly order: PurchaseDetail;
  readonly canWrite: boolean;
  readonly today: string;
}) {
  if (order.status === "received") {
    return (
      <p className="leading-snug">
        Received
        {order.receivedOn ? ` on ${formatDateKey(order.receivedOn)}` : ""}. What
        was on it has been added to the count of each material.
      </p>
    );
  }
  if (order.status === "cancelled") {
    return (
      <p className="leading-snug">Cancelled. Nothing was added to any count.</p>
    );
  }
  if (!canWrite) return <LookOnly />;

  if (order.status === "draft") {
    return (
      <div className="flex flex-col gap-4">
        {order.items.length === 0 ? (
          <p className="leading-snug">
            A draft with nothing on it yet. Add what you are ordering, then mark
            it as sent.
          </p>
        ) : (
          <form action={purchaseSentAction} className="flex flex-col gap-3">
            <Number value={order.number} />
            <p className="leading-snug">
              Once the supplier has the order, mark it as sent.
            </p>
            <Field
              form="sent"
              name="orderedOn"
              label="Sent on"
              kind="date"
              required
              defaultValue={today}
            />
            <Field
              form="sent"
              name="expectedOn"
              label="Due on"
              kind="date"
              defaultValue={order.expectedOn}
              hint={
                order.supplier.leadTimeDays === null
                  ? "The day they say it will arrive, if you know."
                  : `Leave it blank to use their usual ${count(order.supplier.leadTimeDays)} working ${order.supplier.leadTimeDays === 1 ? "day" : "days"}.`
              }
            />
            <SubmitButton pending="Saving" className="bk-btn w-full">
              Mark as sent
            </SubmitButton>
            <p className="bk-notice">
              This only records that the order has gone. Nothing is emailed from
              here yet: print this page, or send {order.supplier.name} the
              details yourself.
            </p>
          </form>
        )}
        <CancelForm order={order} />
      </div>
    );
  }

  // The lines that add to a material's count: each gets a box for how many
  // arrived in good order.
  const counted = order.items.filter((line) => line.materialId !== null);

  return (
    <div className="flex flex-col gap-4">
      <form action={purchaseReceivedAction} className="flex flex-col gap-3">
        <Number value={order.number} />
        <p className="leading-snug">
          Sent{order.orderedOn ? ` on ${formatDateKey(order.orderedOn)}` : ""}
          {order.expectedOn
            ? `, due ${formatDateKey(order.expectedOn)}`
            : ", with no due date"}
          .
          {order.overdue && order.daysLate !== null
            ? ` That was ${count(order.daysLate)} ${order.daysLate === 1 ? "day" : "days"} ago.`
            : ""}
        </p>
        <Field
          form="received"
          name="receivedOn"
          label="Arrived on"
          kind="date"
          required
          defaultValue={today}
        />
        {counted.length > 0 ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="field-label">
              How many arrived in good order
            </legend>
            <Hint>
              Each box starts at what was ordered. Change it if some were short
              or damaged, or if they sent extra. Only what you type here is
              added to the count.
            </Hint>
            {counted.map((line) => (
              <Field
                key={line.id}
                form="received"
                name={`${ACCEPTED_FIELD}${line.id}`}
                label={line.description}
                kind="count"
                required
                defaultValue={line.qty}
                hint={`${count(line.qty)} ordered`}
              />
            ))}
          </fieldset>
        ) : (
          <Hint>
            Nothing on this order is a material, so no count changes when it is
            received.
          </Hint>
        )}
        <SubmitButton pending="Saving" className="bk-btn w-full">
          Mark as received
        </SubmitButton>
        <Hint>
          An order can be received once. If part of it is still to come, mark
          what has arrived and raise a new order for the rest.
        </Hint>
      </form>
      <CancelForm order={order} />
    </div>
  );
}

/**
 * One purchase order. The order itself is laid out to be printed and handed
 * or sent to the supplier (the back end's navigation and every button are
 * hidden on paper). Everything that changes it sits underneath.
 */
export default async function PurchaseOrderPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { number: raw } = await params;
  const { notice, tone } = await searchParams;
  const caller = await staffCaller();
  const now = new Date();

  let order: PurchaseDetail;
  try {
    order = await execute(
      getPurchaseOrder,
      { number: decodeURIComponent(raw) },
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
  const canWrite = staff.role !== "viewer";
  const draft = order.status === "draft";
  const editable = canWrite && draft;
  const [history, materials] = await Promise.all([
    execute(
      listActivity,
      { entityType: "purchase_order", entityId: order.id, limit: 50 },
      caller,
    ),
    editable ? execute(listMaterials, { limit: 500 }, caller) : [],
  ]);
  // What this supplier sells first, then everything else.
  const choices = [
    ...materials.filter((material) => material.supplierId === order.supplierId),
    ...materials.filter((material) => material.supplierId !== order.supplierId),
  ];

  return (
    <div className="mx-auto max-w-[56rem]">
      <div className="bk-noprint">
        <PageHeader
          title={order.number}
          back={{
            href: "/backstage/stock/purchase-orders",
            label: "Purchase orders",
          }}
          lead={
            <>
              For{" "}
              <Link
                href={`/backstage/stock/suppliers/${order.supplierId}`}
                className="link"
              >
                {order.supplierName}
              </Link>
              . Print this page from your browser&apos;s menu: only the order
              itself prints.
            </>
          }
        />
        <p className="-mt-3 mb-5 flex flex-wrap items-center gap-2">
          <PurchaseStatusPill status={order.status} overdue={order.overdue} />
        </p>
        <FormNotice notice={notice} tone={tone} />
      </div>

      <article className="bk-panel bk-panel-pad">
        <header className="border-navy flex flex-wrap items-end justify-between gap-3 border-b-2 pb-4">
          <div>
            <p className="varsity text-[1.6rem] leading-none">{STORE.name}</p>
            <p className="label bk-muted mt-1 text-[1rem]">Purchase order</p>
          </div>
          <div className="text-right">
            <p className="varsity text-[2rem] leading-none tabular-nums">
              {order.number}
            </p>
            <p className="bk-muted mt-1 text-[0.9375rem]">
              {order.orderedOn
                ? `Sent ${formatDateKey(order.orderedOn)}`
                : draft
                  ? "Draft, not sent"
                  : "Not sent"}
            </p>
          </div>
        </header>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <section>
            <h2 className="bk-h2">
              <span className="cap-trim">To</span>
            </h2>
            <p className="mt-2 leading-snug">
              <span className="font-semibold">{order.supplier.name}</span>
              {order.supplier.contactName ? (
                <span className="block">
                  Attention: {order.supplier.contactName}
                </span>
              ) : null}
              {order.supplier.email ? (
                <span className="block [overflow-wrap:anywhere]">
                  {order.supplier.email}
                </span>
              ) : null}
              {order.supplier.phone ? (
                <span className="block">{order.supplier.phone}</span>
              ) : null}
            </p>
          </section>
          <section>
            <h2 className="bk-h2">
              <span className="cap-trim">From</span>
            </h2>
            <p className="mt-2 leading-snug">
              <span className="font-semibold">{STORE.name}</span>
              {STORE.contactEmail ? (
                <span className="block [overflow-wrap:anywhere]">
                  {STORE.contactEmail}
                </span>
              ) : null}
            </p>
            {/* Our legal name, address and GST details are not on file yet
                (see the go-live list). On screen that is said plainly; on
                paper there is room to write them in. */}
            <p className="bk-muted mt-1 text-[0.9375rem] leading-snug print:hidden">
              Our business name, address and GST details are not on file yet.
              Write them on the printed order before it goes to a supplier.
            </p>
            <div className="mt-3 hidden print:block">
              {["Business name", "Address", "GST number, if registered"].map(
                (label) => (
                  <p
                    key={label}
                    className="border-navy mb-3 border-b pb-5 text-[0.875rem]"
                  >
                    {label}
                  </p>
                ),
              )}
            </div>
          </section>
        </div>

        <section id="lines" className="mt-6 scroll-mt-24">
          <h2 className="bk-h2">
            <span className="cap-trim">What is ordered</span>
          </h2>
          {order.items.length === 0 ? (
            <p className="bk-muted mt-2 leading-snug">
              Nothing has been added to this order yet.
            </p>
          ) : (
            <div
              className="bk-table-wrap mt-2"
              role="region"
              aria-label="The lines on this order"
              tabIndex={0}
            >
              <table className="bk-table">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className="bk-num">
                      How many
                    </th>
                    <th scope="col" className="bk-num">
                      Each
                    </th>
                    <th scope="col" className="bk-num">
                      Total
                    </th>
                    {editable ? (
                      <th scope="col" className="bk-noprint">
                        <span className="sr-only">Take off the order</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <span className="font-semibold">
                          {line.description}
                        </span>
                        {line.materialId === null ? (
                          <span className="bk-muted bk-noprint block text-[0.875rem]">
                            Not a material: adds to no count
                          </span>
                        ) : null}
                      </td>
                      <td className="bk-num">
                        {count(line.qty)}
                        {line.unit && line.unit !== "each"
                          ? ` ${line.unit}`
                          : ""}
                      </td>
                      <td className="bk-num">
                        {formatNzdExact(line.unitCostCents)}
                      </td>
                      <td className="bk-num">
                        {formatNzdExact(line.lineCents)}
                      </td>
                      {editable ? (
                        <td className="bk-noprint bk-num">
                          <form action={removeLineAction}>
                            <Number value={order.number} />
                            <input
                              type="hidden"
                              name="lineId"
                              value={line.id}
                            />
                            <SubmitButton
                              pending="Removing"
                              className="bk-btn bk-btn-quiet"
                            >
                              Remove
                              <span className="sr-only">
                                {" "}
                                {line.description}
                              </span>
                            </SubmitButton>
                          </form>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <dl className="bk-kv border-navy mt-2 border-t-2 px-3 py-3">
            <dt>Total</dt>
            <dd className="bk-num font-semibold">
              {formatNzdExact(order.totalCents)}
            </dd>
            <dt>Due</dt>
            <dd className="bk-num">
              {order.expectedOn
                ? formatDateKey(order.expectedOn)
                : "No date set"}
            </dd>
          </dl>
          <p className="bk-muted text-[0.875rem] leading-snug">
            Costs are as entered. GST is not worked out on this page.
          </p>
        </section>

        {order.notes ? (
          <section className="mt-5">
            <h2 className="bk-h2">
              <span className="cap-trim">Notes</span>
            </h2>
            <p className="mt-2 leading-snug whitespace-pre-wrap">
              {order.notes}
            </p>
          </section>
        ) : null}
      </article>

      <div className="bk-noprint mt-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Panel title="Next step">
            <NextStep
              order={order}
              canWrite={canWrite}
              today={nzDateKey(now)}
            />
          </Panel>

          {canWrite && (draft || order.status === "sent") ? (
            <Panel title="Due date and notes">
              <form
                action={updatePurchaseAction}
                className="flex flex-col gap-3"
              >
                <Number value={order.number} />
                <Field
                  form="update"
                  name="expectedOn"
                  label="Due on"
                  kind="date"
                  defaultValue={order.expectedOn}
                  hint="Change it when the supplier gives you a new date."
                />
                <TextArea
                  form="update"
                  name="notes"
                  label="Notes for the supplier"
                  maxLength={4000}
                  rows={2}
                  defaultValue={order.notes}
                  hint="Printed on the order."
                />
                <SubmitButton
                  pending="Saving"
                  className="bk-btn bk-btn-quiet w-full"
                >
                  Save
                </SubmitButton>
              </form>
            </Panel>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          {editable ? (
            <Panel title="Add a line">
              <form action={addLineAction} className="flex flex-col gap-3">
                <Number value={order.number} />
                <Choice
                  form="line"
                  name="materialId"
                  label="Material"
                  defaultValue=""
                  options={[
                    { value: "", label: "Something not on the list" },
                    ...choices.map((material) => ({
                      value: material.id,
                      label:
                        material.supplierId === order.supplierId
                          ? material.name
                          : `${material.name} (${material.supplierName ?? "no supplier set"})`,
                    })),
                  ]}
                  hint="A line for a material adds to that material's count when the order is received."
                />
                <Field
                  form="line"
                  name="description"
                  label="Or say what it is"
                  maxLength={200}
                  hint="Freight, a set-up fee, anything not on the list. Leave it blank to use the material's name."
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    form="line"
                    name="qty"
                    label="How many"
                    kind="count"
                    required
                  />
                  <Field
                    form="line"
                    name="unitCost"
                    label="What one costs"
                    kind="money"
                    hint="Blank uses the material's usual cost."
                  />
                </div>
                <SubmitButton pending="Adding" className="bk-btn w-full">
                  Add to the order
                </SubmitButton>
              </form>
            </Panel>
          ) : null}

          <Panel title="History" flush>
            <ActivityList
              lines={history}
              now={now}
              empty="Nothing has been done to this order yet."
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
