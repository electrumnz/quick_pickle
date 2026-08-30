import { money } from "@/components/admin/data/format";
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
import type { Order } from "@/lib/commerce";

import {
  cancelOrderAction,
  markPackedAction,
  recordRefundAction,
  recordTrackingAction,
} from "./actions";
import {
  CANCEL_REASONS,
  CANCEL_WORDS,
  COURIERS,
  REFUND_REASONS,
  REFUND_WORDS,
  options,
} from "./words";

/**
 * The buttons on an order.
 *
 * The pack form sits open on every row in the queue, because a twenty-order
 * morning is twenty of the same three keystrokes and a fold in front of each
 * one would double the work. The two that cannot be taken back — cancelling,
 * and giving money back — are folded, and the fold says what pressing it will
 * do to this particular order, with this customer's name in the sentence.
 *
 * Every one of these takes a `scope`. One order can appear twice on the page —
 * once in the search results, once in the queue it is still sitting in — and
 * two fields with the same `id` means every `<label for>` on the second copy
 * points at the first. The scope is the section, so the pair stays unique.
 */

const courierOptions = COURIERS.map((courier) => ({
  value: courier,
  label: courier,
}));

function customerOf(order: Order): string {
  return order.customer?.displayName ?? order.email;
}

/** Packed and posted: the courier, the ticket number, one button. */
export function PackForm({
  order,
  csrfToken,
  back,
  scope,
}: {
  order: Order;
  csrfToken: string;
  back: string;
  /** Which section of the page this copy is in. Keeps field ids unique. */
  scope: string;
}) {
  const id = `${scope}-${order.id}`;
  return (
    <form
      action={markPackedAction}
      className="mt-3 flex flex-wrap items-end gap-2"
    >
      <FormFields
        csrfToken={csrfToken}
        back={back}
        values={{ orderId: order.id }}
      />
      <Field
        label="Courier"
        htmlFor={`carrier-${id}`}
        className="w-full sm:w-44"
      >
        <Select
          id={`carrier-${id}`}
          name="carrier"
          defaultValue={
            order.shippingMethod?.startsWith("NZ Post") === true
              ? "NZ Post"
              : COURIERS[0]
          }
          options={courierOptions}
          required
        />
      </Field>
      <Field
        label="Ticket number"
        htmlFor={`ticket-${id}`}
        className="w-full sm:w-52"
      >
        <TextInput
          id={`ticket-${id}`}
          name="trackingNumber"
          required
          maxLength={60}
          placeholder="NZ00123456789"
        />
      </Field>
      <div className="pb-0.5">
        <SubmitButton tone="primary">Packed and posted</SubmitButton>
      </div>
    </form>
  );
}

/** Fix a ticket number on something already on its way. */
export function TrackingForm({
  order,
  csrfToken,
  back,
  scope,
}: {
  order: Order;
  csrfToken: string;
  back: string;
  scope: string;
}) {
  const id = `${scope}-${order.id}`;
  return (
    <Disclosure label="Change the ticket number">
      <form
        action={recordTrackingAction}
        className="flex flex-wrap items-end gap-2"
      >
        <FormFields
          csrfToken={csrfToken}
          back={back}
          values={{ orderId: order.id }}
        />
        <Field
          label="Courier"
          htmlFor={`fix-carrier-${id}`}
          className="w-full sm:w-44"
        >
          <Select
            id={`fix-carrier-${id}`}
            name="carrier"
            defaultValue={order.tracking?.carrier ?? COURIERS[0]}
            options={courierOptions}
            required
          />
        </Field>
        <Field
          label="Ticket number"
          htmlFor={`fix-ticket-${id}`}
          className="w-full sm:w-52"
        >
          <TextInput
            id={`fix-ticket-${id}`}
            name="trackingNumber"
            defaultValue={order.tracking?.number ?? ""}
            required
            maxLength={60}
          />
        </Field>
        <div className="pb-0.5">
          <SubmitButton>Save the ticket number</SubmitButton>
        </div>
      </form>
      <p className="mt-2 text-caption text-muted">
        This changes what the customer is told to look up. It does not send
        anything and it does not book a courier — no admin here can.
      </p>
    </Disclosure>
  );
}

/**
 * Cancelling and refunding, each behind a fold that says what happens.
 *
 * `refundableCents` is the total less anything already given back, so the field
 * cannot be pre-filled with a number bigger than the order was worth.
 */
export function OrderRisks({
  order,
  csrfToken,
  back,
  refundableCents,
  scope,
}: {
  order: Order;
  csrfToken: string;
  back: string;
  refundableCents: number;
  scope: string;
}) {
  const id = `${scope}-${order.id}`;
  const name = customerOf(order);
  const bottles = order.lineItems.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div className="mt-3 flex flex-wrap items-start gap-2">
      {order.status !== "cancelled" && (
        <Confirm
          label="Cancel this order"
          consequence={
            <>
              {order.orderNumber} for {name} is closed for good. If you tick the
              box below, anything that was taken off the shelf for it goes back
              on — which is nothing at all if it was never packed, because the
              bottles never left. Cancelling does not give anyone their money
              back: that is the next fold along, and it is a separate decision
              on purpose.
            </>
          }
        >
          <form action={cancelOrderAction} className="space-y-3">
            <FormFields
              csrfToken={csrfToken}
              back={back}
              values={{ orderId: order.id }}
            />
            <Field label="Why?" htmlFor={`cancel-why-${id}`}>
              <Select
                id={`cancel-why-${id}`}
                name="reason"
                options={options([...CANCEL_REASONS], CANCEL_WORDS)}
                required
              />
            </Field>
            <Checkbox
              id={`restock-${id}`}
              name="restock"
              label={`Put anything taken off the shelf for these ${String(bottles)} bottles back on it`}
              hint="Leave this off if they were broken, drunk, or given away."
              defaultChecked
            />
            <SubmitButton tone="danger">
              Cancel {order.orderNumber}
            </SubmitButton>
          </form>
        </Confirm>
      )}

      {order.paidAt !== null && refundableCents > 0 && (
        <Confirm
          label="Give money back"
          consequence={
            <>
              This writes down that {name} is owed money back on{" "}
              {order.orderNumber}, permanently, with your name on it.{" "}
              <strong className="font-semibold">
                It does not move any money.
              </strong>{" "}
              No payment gateway is connected to this admin, so you still refund
              her in your bank or in Shopify — this is the record that you said
              you would. At most {money(refundableCents)} is left to give back
              on this order.
            </>
          }
        >
          <form action={recordRefundAction} className="space-y-3">
            <FormFields
              csrfToken={csrfToken}
              back={back}
              values={{ orderId: order.id }}
            />
            <Field
              label="How much?"
              htmlFor={`refund-amount-${id}`}
              hint={`In dollars. ${money(refundableCents)} is the most this order has left.`}
            >
              <TextInput
                id={`refund-amount-${id}`}
                name="amount"
                required
                inputMode="decimal"
                pattern="\$?\s*\d{1,7}(\.\d{1,2})?"
                placeholder={(refundableCents / 100).toFixed(2)}
              />
            </Field>
            <Field label="Why?" htmlFor={`refund-why-${id}`}>
              <Select
                id={`refund-why-${id}`}
                name="reason"
                options={options([...REFUND_REASONS], REFUND_WORDS)}
                required
              />
            </Field>
            <Field
              label="Anything to remember about it? (optional)"
              htmlFor={`refund-note-${id}`}
            >
              <Textarea
                id={`refund-note-${id}`}
                name="note"
                rows={2}
                maxLength={500}
                placeholder="Bottle cracked in transit — Post Haste say they will not cover it."
              />
            </Field>
            <SubmitButton tone="danger">Record the refund</SubmitButton>
          </form>
        </Confirm>
      )}
    </div>
  );
}
