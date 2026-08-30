import { Callout, Card, CardBody, CardHeader } from "@/components/admin";
import { ADMIN_CSRF_FIELD_NAME } from "@/lib/auth/server";
import {
  CONSENT_WORDS,
  RIGHTS_WORDS,
  USAGE_RIGHTS,
  type AssetProduct,
  type MarketingAsset,
} from "@/lib/assets";

import {
  Checkbox,
  Field,
  PrimaryButton,
  Select,
  TextArea,
  TextInput,
} from "./bits";

/**
 * Everything about one file that an agent will read.
 *
 * The order is the order of the questions: what is in it, when and where, which
 * bottles, who is in it and did they agree, and where the file came from. The
 * consent block is the only one with a border around it, because it is the only
 * one that decides whether anything can be done with the file at all.
 *
 * A plain form posting to a Server Action: it works before hydration, it works
 * with JavaScript off, and it carries the session's CSRF token exactly like the
 * sign-out form does.
 */
export function MetadataForm({
  asset,
  products,
  csrfToken,
  action,
  saved,
}: {
  asset: MarketingAsset;
  products: readonly AssetProduct[];
  csrfToken: string;
  action: (formData: FormData) => Promise<void>;
  saved: boolean;
}) {
  const chosen = new Set(asset.products.map((product) => product.variantId));
  return (
    <form action={action} className="space-y-5">
      <input
        type="hidden"
        name={ADMIN_CSRF_FIELD_NAME}
        value={csrfToken}
        readOnly
      />
      {/* Whose words these were when the page was drawn, so the save can tell
          whether a model draft has actually been corrected. */}
      <input
        type="hidden"
        name="descriptionSource"
        value={asset.descriptionSource}
        readOnly
      />
      <input
        type="hidden"
        name="descriptionWas"
        value={asset.description}
        readOnly
      />

      {saved && (
        <Callout title="Saved">
          The changes are in the library. Anything the team looks up from now on
          reads what is here.
        </Callout>
      )}

      <Card>
        <CardHeader title="What is in it" />
        <CardBody className="space-y-4">
          <Field label="Name it" htmlFor="title">
            <TextInput id="title" name="title" defaultValue={asset.title} />
          </Field>

          {asset.descriptionSource === "model_draft" && (
            <Callout title="This description was drafted by a vision model">
              It has not been checked. Correct anything it got wrong and save —
              the words below are what the team reads when it decides whether
              this file suits a post.
            </Callout>
          )}

          <Field
            label="What is actually in the frame"
            hint="One line. Say what is there, not how it feels: 'the stall at the Sunday market, four bottles on a trestle table, two people looking at the labels'."
            htmlFor="description"
          >
            <TextArea
              id="description"
              name="description"
              rows={3}
              defaultValue={asset.description}
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="The occasion"
              hint="Where this was. An agent uses it to keep a post in the right place."
              htmlFor="occasion"
            >
              <TextInput
                id="occasion"
                name="occasion"
                defaultValue={asset.occasion ?? ""}
                placeholder="the Sunday market"
              />
            </Field>
            <Field
              label="The day it happened"
              hint="So a summer photo does not go out in July."
              htmlFor="occasionOn"
            >
              <TextInput
                id="occasionOn"
                name="occasionOn"
                type="date"
                defaultValue={asset.occasionOn ?? ""}
              />
            </Field>
          </div>

          <Field
            label="Tags"
            hint="Free text, separated by commas. Whatever you would search for."
            htmlFor="tags"
          >
            <TextInput
              id="tags"
              name="tags"
              defaultValue={asset.tags.join(", ")}
              placeholder="market, stall, spring"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Which bottles are in it"
          note="Tick the ones you can actually see"
        />
        <CardBody className="grid gap-2.5 sm:grid-cols-2">
          {products.map((product) => (
            <Checkbox
              key={product.variantId}
              id={`variant-${product.variantId}`}
              name="variantIds"
              label={`${product.productTitle} · ${product.sku}`}
              defaultChecked={chosen.has(product.variantId)}
            />
          ))}
        </CardBody>
      </Card>

      <Card className="border-strong">
        <CardHeader
          title="People, and whether they agreed"
          note="This one decides what the team may do"
        />
        <CardBody className="space-y-4">
          <Checkbox
            id="peoplePresent"
            name="peoplePresent"
            label="There are identifiable people in this one"
            hint="Anyone whose face you could recognise, including customers in the background."
            defaultChecked={asset.peoplePresent}
          />
          <Field
            label="Did they agree to it being published?"
            hint="Until this says they agreed, nothing on the team can choose this file for anything that leaves the company. That is enforced in the tool, not here."
            htmlFor="peopleConsent"
          >
            <Select
              id="peopleConsent"
              name="peopleConsent"
              defaultValue={asset.peopleConsent}
              options={[
                {
                  value: "no_people",
                  label: CONSENT_WORDS.no_people.label,
                },
                { value: "unrecorded", label: CONSENT_WORDS.unrecorded.label },
                { value: "granted", label: CONSENT_WORDS.granted.label },
                { value: "refused", label: CONSENT_WORDS.refused.label },
              ]}
            />
          </Field>
          <Field
            label="Note about the consent"
            hint="Who you asked, when, and what they said. Your own record."
            htmlFor="consentNote"
          >
            <TextInput
              id="consentNote"
              name="consentNote"
              defaultValue={asset.consentNote ?? ""}
              placeholder="Asked them at the stall on the day; both happy."
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Where the file came from" />
        <CardBody className="space-y-4">
          <Field label="Usage rights" htmlFor="usageRights">
            <Select
              id="usageRights"
              name="usageRights"
              defaultValue={asset.usageRights}
              options={USAGE_RIGHTS.map((right) => ({
                value: right,
                label: RIGHTS_WORDS[right].label,
              }))}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Credit"
              hint="Needed for anything that is not your own photograph."
              htmlFor="credit"
            >
              <TextInput
                id="credit"
                name="credit"
                defaultValue={asset.credit ?? ""}
              />
            </Field>
            <Field
              label="Rights run out on"
              hint="Leave empty when there is no end date."
              htmlFor="rightsExpireOn"
            >
              <TextInput
                id="rightsExpireOn"
                name="rightsExpireOn"
                type="date"
                defaultValue={asset.rightsExpireOn ?? ""}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton type="submit">Save this</PrimaryButton>
        <p className="text-caption text-muted">
          Saving changes what the team reads. It does not publish anything.
        </p>
      </div>
    </form>
  );
}
