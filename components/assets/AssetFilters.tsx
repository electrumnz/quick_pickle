import Link from "next/link";

import { CONSENT_STATES, FRAME_NAMES, FRAMES } from "@/lib/assets";
import type { AssetProduct } from "@/lib/assets";

import { Field, Select, TextInput } from "./bits";
import { consentBadge } from "./words";

/**
 * Narrowing the wall down.
 *
 * A plain `GET` form: no JavaScript, every state is a URL she can bookmark or
 * send, and the back button does what she expects. The fields are the same ones
 * the agents search on — occasion, product, tag, shape, consent — so what she
 * sees when she filters is what an agent would find.
 */
export interface FilterValues {
  readonly q: string;
  readonly kind: string;
  readonly sku: string;
  readonly frame: string;
  readonly consent: string;
  readonly from: string;
  readonly to: string;
}

export function AssetFilters({
  values,
  products,
  total,
}: {
  values: FilterValues;
  products: readonly AssetProduct[];
  total: number;
}) {
  const anySet = Object.values(values).some((value) => value !== "");
  return (
    <form
      method="get"
      action="/admin/assets"
      className="rounded-lg border border-hairline bg-surface-raised px-4 py-4"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Words in it" htmlFor="filter-q">
          <TextInput
            id="filter-q"
            name="q"
            defaultValue={values.q}
            placeholder="market, bar, bottling"
          />
        </Field>
        <Field label="Photo or video" htmlFor="filter-kind">
          <Select
            id="filter-kind"
            name="kind"
            defaultValue={values.kind}
            options={[
              { value: "", label: "Both" },
              { value: "photo", label: "Photos" },
              { value: "video", label: "Video" },
            ]}
          />
        </Field>
        <Field label="Bottle in it" htmlFor="filter-sku">
          <Select
            id="filter-sku"
            name="sku"
            defaultValue={values.sku}
            options={[
              { value: "", label: "Any" },
              ...products.map((product) => ({
                value: product.sku,
                label: `${product.productTitle} (${product.sku})`,
              })),
            ]}
          />
        </Field>
        <Field
          label="Shape"
          hint="What it would fit without a crop."
          htmlFor="filter-frame"
        >
          <Select
            id="filter-frame"
            name="frame"
            defaultValue={values.frame}
            options={[
              { value: "", label: "Any shape" },
              ...FRAME_NAMES.map((frame) => ({
                value: frame,
                label: FRAMES[frame].label,
              })),
            ]}
          />
        </Field>
        <Field label="People and consent" htmlFor="filter-consent">
          <Select
            id="filter-consent"
            name="consent"
            defaultValue={values.consent}
            options={[
              { value: "", label: "Any" },
              ...CONSENT_STATES.map((state) => ({
                value: state,
                label: consentBadge(state).label,
              })),
            ]}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" htmlFor="filter-from">
            <TextInput
              id="filter-from"
              name="from"
              type="date"
              defaultValue={values.from}
            />
          </Field>
          <Field label="To" htmlFor="filter-to">
            <TextInput
              id="filter-to"
              name="to"
              type="date"
              defaultValue={values.to}
            />
          </Field>
        </div>
      </div>
      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="inline-flex items-center rounded-md border border-strong bg-surface-raised px-3.5 py-2 text-body-sm font-medium text-primary"
        >
          Show these
        </button>
        {anySet && (
          <Link
            href="/admin/assets"
            className="rounded-sm text-caption text-link underline underline-offset-4 hover:no-underline"
          >
            Clear the filters
          </Link>
        )}
        <p className="text-caption text-muted">
          {total === 1 ? "1 file" : `${String(total)} files`} in the library
        </p>
      </div>
    </form>
  );
}
