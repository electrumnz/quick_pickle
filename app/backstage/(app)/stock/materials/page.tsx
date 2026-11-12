import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Empty, PageHeader, Panel, Pill } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { listMaterials, listSuppliers } from "@/lib/backstage/stock/ops";

import { createMaterialAction } from "../actions";
import { Choice, count, Field, FormNotice, TextArea } from "../parts";

export const metadata: Metadata = { title: "Materials" };

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{
    name?: string;
    unit?: string;
    supplierId?: string;
    onHand?: string;
    reorderAt?: string;
    unitCost?: string;
    notes?: string;
    notice?: string;
    tone?: string;
  }>;
}) {
  const staff = await requireStaff();
  const params = await searchParams;
  const caller = await staffCaller();
  const [rows, suppliers] = await Promise.all([
    execute(listMaterials, { limit: 500 }, caller),
    execute(listSuppliers, { show: "active", limit: 200 }, caller),
  ]);
  const canWrite = staff.role !== "viewer";
  const low = rows.filter((row) => row.low).length;

  return (
    <>
      <PageHeader
        title="Materials"
        back={{ href: "/backstage/stock", label: "Stock" }}
        lead={
          rows.length === 0
            ? "The things you buy in to make and send the product: bottles, caps, labels, cartons."
            : low === 0
              ? "Nothing is at its reorder level."
              : `${count(low)} ${low === 1 ? "is" : "are"} at or under the reorder level.`
        }
      />
      <FormNotice notice={params.notice} tone={params.tone} />

      <Panel flush>
        {rows.length === 0 ? (
          <>
            <Empty title="No materials yet">
              List what you buy in, how many you have and the level at which to
              buy more, and this page will say when it is time to reorder.
            </Empty>
            {canWrite ? (
              <p className="-mt-4 pb-8 text-center">
                <a href="#new" className="bk-btn">
                  <span className="cap-trim">Add the first material</span>
                </a>
              </p>
            ) : null}
          </>
        ) : (
          <ul className="bk-rows">
            {rows.map((material) => (
              <li key={material.id}>
                <Link
                  href={`/backstage/stock/materials/${material.id}`}
                  className="bk-row grid-cols-[1fr_auto]"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {material.name}
                      {material.low ? <Pill tone="todo">Reorder</Pill> : null}
                    </span>
                    <span className="bk-muted block truncate text-[0.9375rem]">
                      {material.supplierName ?? "No supplier set"}
                      {material.unit === "each"
                        ? ""
                        : ` · counted by the ${material.unit}`}
                    </span>
                  </span>
                  <span className="flex flex-col items-end">
                    <span className="bk-num">
                      <span className="font-semibold">
                        {count(material.onHand)}
                      </span>{" "}
                      <span className="bk-muted text-[0.9375rem]">on hand</span>
                    </span>
                    <span className="bk-muted bk-num text-[0.875rem]">
                      {material.onOrder > 0
                        ? `${count(material.onOrder)} on order`
                        : material.reorderAt === null
                          ? "No reorder level"
                          : `Reorder at ${count(material.reorderAt)}`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canWrite ? (
        <Panel title="Add a material" className="mt-6 max-w-[40rem]">
          <form
            id="new"
            action={createMaterialAction}
            className="flex scroll-mt-24 flex-col gap-4"
          >
            <Field
              form="material"
              name="name"
              label="What it is"
              required
              maxLength={120}
              defaultValue={params.name}
              placeholder="100 ml bottle"
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                form="material"
                name="unit"
                label="Counted by the"
                maxLength={20}
                defaultValue={params.unit ?? "each"}
                hint="Each, roll, box, carton."
              />
              <Choice
                form="material"
                name="supplierId"
                label="Bought from"
                defaultValue={params.supplierId}
                options={[
                  { value: "", label: "Not set" },
                  ...suppliers.map((supplier) => ({
                    value: supplier.id,
                    label: supplier.name,
                  })),
                ]}
                hint={
                  suppliers.length === 0
                    ? "Add your suppliers first to pick one here."
                    : undefined
                }
              />
              <Field
                form="material"
                name="onHand"
                label="On hand now"
                kind="count"
                defaultValue={params.onHand ?? "0"}
              />
              <Field
                form="material"
                name="reorderAt"
                label="Reorder at"
                kind="count"
                defaultValue={params.reorderAt}
                hint="When the count falls to this, it is flagged. Leave it blank for no flag."
              />
              <Field
                form="material"
                name="unitCost"
                label="What one costs"
                kind="money"
                defaultValue={params.unitCost}
                placeholder="0.35"
                hint="In dollars, if you know it."
              />
            </div>
            <TextArea
              form="material"
              name="notes"
              label="Notes"
              maxLength={4000}
              rows={2}
              defaultValue={params.notes}
            />
            <SubmitButton pending="Adding" className="bk-btn w-full">
              Add the material
            </SubmitButton>
          </form>
        </Panel>
      ) : null}
    </>
  );
}
