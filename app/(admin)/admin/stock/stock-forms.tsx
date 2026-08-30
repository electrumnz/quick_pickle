import { count, quantity } from "@/components/admin/data/format";
import type { SkuStock } from "@/components/admin/data/commerce-reads";
import type {
  BatchItem,
  IngredientItem,
} from "@/components/admin/data/queries";
import {
  Checkbox,
  Confirm,
  Disclosure,
  Field,
  FormFields,
  Select,
  SubmitButton,
  Textarea,
  TextInput,
} from "@/components/admin/ui/controls";

import {
  adjustStockAction,
  openBatchAction,
  releaseBatchAction,
  setReorderPointAction,
} from "./actions";
import type { OpenableRecipe, StockPlace } from "./data";
import { COUNT_REASON_WORDS, INVENTORY_REASONS, options } from "./words";

/**
 * The forms on Stock & Batches.
 *
 * The counts she corrects most — a breakage, a stocktake, a bottle handed to a
 * bar — are one fold from every line. The two that put stock into or out of
 * existence are folded further and say what they will do, because releasing a
 * batch is a food-safety act: once it is released it can be sold, and the
 * bottles that go out under it carry its best-before.
 */

function placeOptions(
  places: readonly StockPlace[],
): readonly { readonly value: string; readonly label: string }[] {
  return places.map((place) => ({ value: place.id, label: place.name }));
}

/** Correct the count on one line, with a reason a recall could read back. */
export function AdjustStockForm({
  line,
  variantId,
  places,
  csrfToken,
  back,
}: {
  line: SkuStock;
  variantId: string | undefined;
  places: readonly StockPlace[];
  csrfToken: string;
  back: string;
}) {
  if (variantId === undefined || places.length === 0) return null;
  const id = line.sku;
  const here = line.locations[0]?.locationName;
  const defaultPlace =
    places.find((place) => place.name === here)?.id ?? places[0]?.id;

  return (
    <div className="mt-3">
      <Disclosure label="Correct the count">
        <form action={adjustStockAction} className="space-y-3">
          <FormFields
            csrfToken={csrfToken}
            back={back}
            values={{ variantId }}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Where" htmlFor={`place-${id}`}>
              <Select
                id={`place-${id}`}
                name="locationId"
                defaultValue={defaultPlace}
                options={placeOptions(places)}
                required
              />
            </Field>
            <Field label="Add or take off" htmlFor={`dir-${id}`}>
              <Select
                id={`dir-${id}`}
                name="direction"
                defaultValue="remove"
                options={[
                  { value: "remove", label: "Take off the shelf" },
                  { value: "add", label: "Put back on the shelf" },
                ]}
                required
              />
            </Field>
            <Field
              label="How many bottles"
              htmlFor={`size-${id}`}
              hint={`${count(line.available)} are ready to sell right now.`}
            >
              <TextInput
                id={`size-${id}`}
                name="size"
                required
                inputMode="numeric"
                pattern="\d{1,6}"
                placeholder="6"
              />
            </Field>
            <Field label="Why" htmlFor={`why-${id}`}>
              <Select
                id={`why-${id}`}
                name="reason"
                defaultValue="stocktake"
                options={options([...INVENTORY_REASONS], COUNT_REASON_WORDS)}
                required
              />
            </Field>
          </div>
          <Field
            label="Anything to remember? (optional)"
            htmlFor={`note-${id}`}
          >
            <TextInput
              id={`note-${id}`}
              name="note"
              maxLength={300}
              placeholder="Two cracked in the crate coming back from the market"
            />
          </Field>
          <SubmitButton tone="primary">Correct the count</SubmitButton>
          <p className="text-caption text-muted">
            This writes a line in the stock ledger with your reason on it, which
            is what a recall reads back. It cannot take a count below zero.
          </p>
        </form>
      </Disclosure>
    </div>
  );
}

/** Start a batch. */
export function OpenBatchForm({
  recipes,
  places,
  csrfToken,
  back,
}: {
  recipes: readonly OpenableRecipe[];
  places: readonly StockPlace[];
  csrfToken: string;
  back: string;
}) {
  if (recipes.length === 0 || places.length === 0) return null;
  const first = recipes[0];
  return (
    <Disclosure label="Open a batch">
      <form action={openBatchAction} className="space-y-3">
        <FormFields csrfToken={csrfToken} back={back} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Which recipe"
            htmlFor="open-recipe"
            hint="Only the current version of a live recipe can be opened."
          >
            <Select
              id="open-recipe"
              name="recipeId"
              options={recipes.map((recipe) => ({
                value: recipe.id,
                label: `${recipe.productTitle} — ${recipe.name}`,
              }))}
              required
            />
          </Field>
          <Field label="Where it is being made" htmlFor="open-place">
            <Select
              id="open-place"
              name="locationId"
              options={placeOptions(places)}
              required
            />
          </Field>
          <Field
            label="How many litres"
            htmlFor="open-litres"
            hint={
              first === undefined
                ? undefined
                : `A standard run of ${first.name} is ${quantity(first.batchSizeLitres, "litres")}.`
            }
          >
            <TextInput
              id="open-litres"
              name="litres"
              required
              inputMode="decimal"
              pattern="\d{1,5}(\.\d{1,3})?"
              placeholder={
                first === undefined ? "330" : String(first.batchSizeLitres)
              }
            />
          </Field>
        </div>
        <Field label="Notes (optional)" htmlFor="open-notes">
          <TextInput
            id="open-notes"
            name="notes"
            maxLength={500}
            placeholder="Kawakawa picked Thursday, leaves a bit young"
          />
        </Field>
        <SubmitButton tone="primary">Open the batch</SubmitButton>
        <p className="text-caption text-muted">
          The batch is written down with the recipe it was made from and every
          ingredient in it, scaled to the litres you gave, so a bottle can
          always be walked back to what went in it. The store room count comes
          down by that much.
        </p>
      </form>
    </Disclosure>
  );
}

/** Let a batch go, and put its bottles on the shelf. */
export function ReleaseBatchForm({
  batch,
  places,
  csrfToken,
  back,
}: {
  batch: BatchItem;
  places: readonly StockPlace[];
  csrfToken: string;
  back: string;
}) {
  if (places.length === 0) return null;
  const id = batch.id;
  const defaultPlace =
    batch.locationId ??
    places.find((place) => place.name === batch.locationName)?.id ??
    places[0]?.id;

  return (
    <div className="mt-3">
      <Confirm
        label="Release it for sale"
        consequence={
          <>
            Batch {batch.code} becomes sellable stock. The bottles you count
            below go on the shelf straight away, the ledger records that they
            came from this batch, and every one of them carries the best-before
            you set here for the rest of its life. A released batch cannot be
            un-released from this screen.
          </>
        }
      >
        <form action={releaseBatchAction} className="space-y-3">
          <FormFields
            csrfToken={csrfToken}
            back={back}
            values={{ batchId: id }}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bottles filled" htmlFor={`made-${id}`}>
              <TextInput
                id={`made-${id}`}
                name="unitsProduced"
                required
                inputMode="numeric"
                pattern="\d{1,6}"
                placeholder="640"
              />
            </Field>
            <Field
              label="Of those, thrown"
              htmlFor={`binned-${id}`}
              hint="Short fills, bad seals, anything not going out."
            >
              <TextInput
                id={`binned-${id}`}
                name="unitsRejected"
                required
                defaultValue="0"
                inputMode="numeric"
                pattern="\d{1,6}"
              />
            </Field>
            <Field label="Best before" htmlFor={`bb-${id}`}>
              <TextInput
                id={`bb-${id}`}
                name="bestBefore"
                type="date"
                required
              />
            </Field>
            <Field label="Where the bottles go" htmlFor={`to-${id}`}>
              <Select
                id={`to-${id}`}
                name="locationId"
                defaultValue={defaultPlace}
                options={placeOptions(places)}
                required
              />
            </Field>
          </div>
          <Field label="How the check went (optional)" htmlFor={`qa-${id}`}>
            <Textarea
              id={`qa-${id}`}
              name="qaNotes"
              rows={2}
              maxLength={500}
              placeholder="pH 3.4, salinity 3.1%, tastes right"
            />
          </Field>
          <Checkbox
            id={`pass-${id}`}
            name="qaPassed"
            label="I have checked this batch and it passed"
            hint="Nothing is released without this. Your name goes on the check."
          />
          <SubmitButton tone="danger">Release {batch.code}</SubmitButton>
        </form>
      </Confirm>
    </div>
  );
}

/** Move the point at which an ingredient starts shouting. */
export function ReorderPointForm({
  ingredient,
  csrfToken,
  back,
}: {
  ingredient: IngredientItem;
  csrfToken: string;
  back: string;
}) {
  const id = ingredient.id;
  return (
    <Disclosure label="Change">
      <form action={setReorderPointAction} className="space-y-3">
        <FormFields
          csrfToken={csrfToken}
          back={back}
          values={{ ingredientId: id }}
        />
        <Field
          label={`Tell me when ${ingredient.name} drops to`}
          htmlFor={`rp-${id}`}
          hint={`In ${ingredient.unit}. There is ${quantity(ingredient.stockOnHand, ingredient.unit)} in the store room.`}
        >
          <TextInput
            id={`rp-${id}`}
            name="reorderPoint"
            required
            defaultValue={String(ingredient.reorderPoint)}
            inputMode="decimal"
            pattern="\d{1,7}(\.\d{1,3})?"
          />
        </Field>
        <Field
          label="And the usual order is"
          htmlFor={`rq-${id}`}
          hint={
            ingredient.supplierLeadDays === null
              ? "No lead time recorded for this supplier yet."
              : `${ingredient.supplierName ?? "The supplier"} takes about ${String(ingredient.supplierLeadDays)} days.`
          }
        >
          <TextInput
            id={`rq-${id}`}
            name="reorderQuantity"
            required
            defaultValue={String(ingredient.reorderQuantity)}
            inputMode="decimal"
            pattern="\d{1,7}(\.\d{1,3})?"
          />
        </Field>
        <SubmitButton>Save</SubmitButton>
      </form>
    </Disclosure>
  );
}
