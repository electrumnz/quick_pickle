import { dateInputValue } from "@/lib/backstage/marketing/dates";
import type { PromoRow } from "@/lib/backstage/marketing/promo-codes";
import {
  PROMO_KIND_LABEL,
  PROMO_KINDS,
} from "@/lib/backstage/marketing/status";

import { formatNzd } from "@/lib/shop/money";
import { formatNzDate } from "@/lib/time";

import { CheckField, SelectField, TextField } from "../parts";

/** The small print of a code, in one line. */
export function promoSmallPrint(promo: PromoRow): string {
  const parts: string[] = [];
  if (promo.minSubtotalCents > 0) {
    parts.push(`on ${formatNzd(promo.minSubtotalCents)} or more`);
  }
  if (promo.startsAt) parts.push(`from ${formatNzDate(promo.startsAt)}`);
  if (promo.endsAt) {
    // Stored as the midnight after its last day.
    parts.push(
      `to the end of ${formatNzDate(new Date(promo.endsAt.getTime() - 1))}`,
    );
  }
  if (promo.oncePerCustomer) parts.push("once each");
  parts.push(
    promo.maxUses === null
      ? `used ${String(promo.uses)} ${promo.uses === 1 ? "time" : "times"}`
      : `used ${String(promo.uses)} of ${String(promo.maxUses)}`,
  );
  return parts.join(" · ");
}

/** Cents as a form shows them: "5", "12.50". */
function dollars(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0
    ? String(whole)
    : `${String(whole)}.${String(rest).padStart(2, "0")}`;
}

/** The terms of a promo code, for the new form and the change form alike. */
export function PromoFields({
  values,
  kindLocked = false,
  partners,
  forPartnerId,
}: {
  readonly values?: PromoRow;
  /** Once a code has been used, what kind of code it is cannot change. */
  readonly kindLocked?: boolean;
  /** The clubs, creators and events a code can be made for. */
  readonly partners: readonly { readonly id: string; readonly name: string }[];
  /** For a new code started from a partner's page: already picked. */
  readonly forPartnerId?: string;
}) {
  return (
    <>
      <SelectField
        id="promo-partner"
        name="partnerId"
        label="Whose code is it?"
        defaultValue={values?.partnerId ?? forPartnerId ?? ""}
        options={[
          { value: "", label: "Ours" },
          ...partners.map((partner) => ({
            value: partner.id,
            label: partner.name,
          })),
        ]}
        hint="Pick a club, a creator or an event and every order placed with this code is counted as theirs, with whatever cut they are on. Add them under Partners first."
      />
      {kindLocked && values ? (
        <input type="hidden" name="kind" value={values.kind} />
      ) : (
        <SelectField
          id="promo-kind"
          name="kind"
          label="What it gives"
          defaultValue={values?.kind ?? "percent"}
          options={PROMO_KINDS.map((kind) => ({
            value: kind,
            label: PROMO_KIND_LABEL[kind],
          }))}
          hint="Fill in the one box below that goes with it. Free delivery needs neither, and a rural extra still applies."
        />
      )}
      {kindLocked && values?.kind !== "percent" ? null : (
        <TextField
          id="promo-percent"
          name="percent"
          label="Percentage off"
          inputMode="numeric"
          maxLength={3}
          defaultValue={
            values?.kind === "percent" ? String(values.value) : undefined
          }
          hint="A whole number from 1 to 100. Worked out on the goods, not delivery, and rounded to the cent in the customer's favour."
        />
      )}
      {kindLocked && values?.kind !== "amount" ? null : (
        <TextField
          id="promo-amount"
          name="amount"
          label="Dollars off"
          inputMode="decimal"
          maxLength={10}
          defaultValue={
            values?.kind === "amount" ? dollars(values.value) : undefined
          }
          hint="For example 5 or 7.50. It never takes an order below nothing."
        />
      )}
      <TextField
        id="promo-min"
        name="min"
        label="Smallest order it works on"
        inputMode="decimal"
        maxLength={10}
        defaultValue={
          values && values.minSubtotalCents > 0
            ? dollars(values.minSubtotalCents)
            : undefined
        }
        hint="In dollars, before delivery. Leave empty for any order."
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          id="promo-first"
          name="firstDay"
          type="date"
          label="First day"
          defaultValue={
            values?.startsAt ? dateInputValue(values.startsAt) : undefined
          }
        />
        <TextField
          id="promo-last"
          name="lastDay"
          type="date"
          label="Last day"
          defaultValue={
            values?.endsAt
              ? dateInputValue(new Date(values.endsAt.getTime() - 1))
              : undefined
          }
        />
      </div>
      <p className="bk-muted -mt-1 text-[0.9375rem] leading-snug">
        New Zealand days. Leave either empty for no start or no end. It works to
        the end of the last day.
      </p>
      <TextField
        id="promo-max"
        name="maxUses"
        label="Most times it can be used"
        inputMode="numeric"
        maxLength={7}
        defaultValue={
          values?.maxUses == null ? undefined : String(values.maxUses)
        }
        hint="Across everybody. Leave empty for no limit."
      />
      <CheckField
        id="promo-once"
        name="oncePerCustomer"
        label="Once for each customer"
        defaultChecked={values?.oncePerCustomer ?? false}
        hint="Each email address can use it on one order. Good for a first-order or welcome code."
      />
      <TextField
        id="promo-note"
        name="note"
        label="Note"
        maxLength={500}
        defaultValue={values?.note}
        hint="What it is for. Only staff see this."
      />
    </>
  );
}
