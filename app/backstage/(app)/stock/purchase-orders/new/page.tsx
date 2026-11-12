import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Empty, PageHeader, Panel } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { listSuppliers } from "@/lib/backstage/stock/ops";

import { createPurchaseAction } from "../../actions";
import {
  Choice,
  Field,
  FormNotice,
  Hint,
  LookOnly,
  TextArea,
} from "../../parts";

export const metadata: Metadata = { title: "New purchase order" };

/**
 * Start a purchase order: pick the supplier, and the draft opens ready for
 * its lines. If the form is turned away, what was picked comes back in the
 * address.
 */
export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{
    supplierId?: string;
    expectedOn?: string;
    notes?: string;
    notice?: string;
    tone?: string;
  }>;
}) {
  const staff = await requireStaff();
  const params = await searchParams;
  const suppliers = await execute(
    listSuppliers,
    { show: "active", limit: 200 },
    await staffCaller(),
  );
  const canWrite = staff.role !== "viewer";

  return (
    <>
      <PageHeader
        title="New purchase order"
        back={{
          href: "/backstage/stock/purchase-orders",
          label: "Purchase orders",
        }}
        lead="Pick who it is for. It starts as a draft, and you add what you are ordering on the next screen."
      />
      <FormNotice notice={params.notice} tone={params.tone} />

      <Panel className="max-w-[40rem]">
        {!canWrite ? (
          <LookOnly />
        ) : suppliers.length === 0 ? (
          <>
            <Empty title="Add a supplier first">
              A purchase order is always for a supplier, and there are none in
              use yet.
            </Empty>
            <p className="-mt-4 pb-4 text-center">
              <Link href="/backstage/stock/suppliers#new" className="bk-btn">
                <span className="cap-trim">Add a supplier</span>
              </Link>
            </p>
          </>
        ) : (
          <form action={createPurchaseAction} className="flex flex-col gap-4">
            <Choice
              form="purchase"
              name="supplierId"
              label="Supplier"
              required
              defaultValue={params.supplierId ?? suppliers[0]?.id}
              options={suppliers.map((supplier) => ({
                value: supplier.id,
                label: supplier.name,
              }))}
            />
            <Field
              form="purchase"
              name="expectedOn"
              label="Due on"
              kind="date"
              defaultValue={params.expectedOn}
              hint="Leave it blank and it is worked out from the supplier's lead time when you mark the order as sent."
            />
            <TextArea
              form="purchase"
              name="notes"
              label="Notes"
              maxLength={4000}
              rows={2}
              defaultValue={params.notes}
              hint="Printed on the order, so the supplier sees them."
            />
            <div>
              <SubmitButton pending="Starting" className="bk-btn w-full">
                Start the draft
              </SubmitButton>
              <Hint>
                Nothing is sent to the supplier. A draft is only a note to
                yourself until you mark it as sent.
              </Hint>
            </div>
          </form>
        )}
      </Panel>
    </>
  );
}
