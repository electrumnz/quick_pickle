import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityList } from "@/components/backstage/ActivityList";
import {
  OrderStatusPill,
  PaymentPill,
  TestPill,
} from "@/components/backstage/orders";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import {
  Notice,
  PageHeader,
  Panel,
  Pill,
  When,
  type PillTone,
} from "@/components/backstage/ui";
import { listActivity } from "@/lib/backstage/activity/ops";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  listOrderEmails,
  type OrderEmail,
} from "@/lib/backstage/orders/emails";
import { getOrder, type OrderDetail } from "@/lib/backstage/orders/ops";
import { refundsThroughStripe } from "@/lib/backstage/orders/refunds";
import { orderStock, type OrderStock } from "@/lib/backstage/stock/ops";
import { mailConnection } from "@/lib/mail";
import { formatNzd, formatNzdExact } from "@/lib/shop/money";
import { NZ_REGIONS } from "@/lib/shop/order";
import { formatNzDateTime } from "@/lib/time";

import {
  CancelRestock,
  OrderStockPanel,
  PackFrom,
  ShipNote,
  UnpackNote,
} from "../../stock/order-parts";
import {
  addressAction,
  cancelAction,
  deliveredAction,
  noteAction,
  packAction,
  refundAction,
  retryEmailAction,
  shipAction,
} from "../actions";

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

/** How each state of an email reads on the order. */
const EMAIL_STATE: Readonly<
  Record<
    OrderEmail["status"],
    { readonly word: string; readonly tone: PillTone }
  >
> = {
  queued: { word: "Waiting to go", tone: "doing" },
  sent: { word: "Sent", tone: "done" },
  not_sent: { word: "Not sent", tone: "off" },
  failed: { word: "Did not go", tone: "todo" },
  bounced: { word: "Came back", tone: "todo" },
  // An order's own emails are never one of these two.
  received: { word: "Received", tone: "plain" },
  draft: { word: "Draft", tone: "plain" },
};

/**
 * The emails written to the customer about this order, and what became of
 * each. Only one marked "Sent" has reached them.
 */
function Emails({
  number,
  emails,
  lead,
  canWrite,
}: {
  readonly number: string;
  readonly emails: readonly OrderEmail[];
  /** Whether anything is being sent at all, in a sentence. */
  readonly lead: string;
  readonly canWrite: boolean;
}) {
  return (
    <Panel title="Emails to the customer" flush>
      <p className="px-4 pt-4 leading-snug md:px-6">{lead}</p>
      {emails.length === 0 ? (
        <p className="bk-muted px-4 pt-2 pb-4 leading-snug md:px-6">
          None has been written for this order yet.
        </p>
      ) : (
        <ul className="bk-rows mt-3" data-testid="order-emails">
          {emails.map((email) => {
            const state = EMAIL_STATE[email.status];
            return (
              <li key={email.id} className="px-4 py-3 md:px-6">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{email.label}</p>
                  <Pill tone={state.tone}>{state.word}</Pill>
                </div>
                <p className="bk-muted mt-1 text-[0.9375rem] leading-snug [overflow-wrap:anywhere]">
                  To {email.to}, <When at={email.at} />. Subject:{" "}
                  {email.subject}
                </p>
                {email.why !== null ? (
                  <p className="mt-1 text-[0.9375rem] leading-snug">
                    {email.why}
                  </p>
                ) : null}
                {email.canRetry && canWrite ? (
                  <form action={retryEmailAction} className="mt-2">
                    <Number value={number} />
                    <input type="hidden" name="messageId" value={email.id} />
                    <SubmitButton
                      pending="Queuing"
                      className="bk-btn bk-btn-quiet"
                    >
                      Try sending it again
                    </SubmitButton>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** What to do with this order now. Only what its stage allows is offered. */
function NextStep({
  order,
  canWrite,
  stock,
  emailing,
}: {
  readonly order: OrderDetail;
  readonly canWrite: boolean;
  /** Where its shots come from when it is packed (lib/backstage/stock). */
  readonly stock: OrderStock;
  /** This order's customer is really emailed as it moves along. */
  readonly emailing: boolean;
}) {
  if (!canWrite) {
    return (
      <p className="bk-muted leading-snug">
        Your account can look but not change things.
      </p>
    );
  }
  const can = (to: string) => order.next.some((status) => status === to);

  if (order.next.length === 0) {
    return (
      <p className="leading-snug">
        {order.status === "cancelled"
          ? `Cancelled${order.cancelReason ? `: ${order.cancelReason}` : "."}`
          : "Delivered. Nothing more to do."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {order.status === "pending" ? (
        <p className="leading-snug">
          Waiting for the payment to come through. Do not pack it yet.
        </p>
      ) : null}

      {can("packed") ? (
        <form action={packAction} className="flex flex-col gap-3">
          <Number value={order.number} />
          <PackFrom stock={stock}>
            <SubmitButton pending="Saving" className="bk-btn w-full">
              Mark as packed
            </SubmitButton>
          </PackFrom>
        </form>
      ) : null}

      {can("shipped") ? (
        <form action={shipAction} className="flex flex-col gap-3">
          <Number value={order.number} />
          <div>
            <label htmlFor="carrier" className="field-label">
              Courier
            </label>
            <input
              id="carrier"
              name="carrier"
              defaultValue={order.carrier ?? ""}
              placeholder="NZ Post"
              className="field"
            />
          </div>
          <div>
            <label htmlFor="trackingNumber" className="field-label">
              Tracking number
            </label>
            <input
              id="trackingNumber"
              name="trackingNumber"
              defaultValue={order.trackingNumber ?? ""}
              autoCapitalize="characters"
              spellCheck={false}
              className="field"
            />
          </div>
          <div>
            <label htmlFor="trackingUrl" className="field-label">
              Tracking link
            </label>
            <input
              id="trackingUrl"
              name="trackingUrl"
              type="url"
              inputMode="url"
              defaultValue={order.trackingUrl ?? ""}
              placeholder="https://"
              className="field"
            />
          </div>
          <SubmitButton
            pending="Saving"
            className={`bk-btn w-full ${can("packed") ? "bk-btn-quiet" : ""}`}
          >
            Mark as shipped
          </SubmitButton>
          <p className="bk-muted text-[0.9375rem] leading-snug">
            {emailing
              ? "This emails the customer that it is on its way, with the courier and the tracking details if you give them. It cannot be undone."
              : order.isTest
                ? "This cannot be undone. A test order's customer is not emailed."
                : "This cannot be undone. Order emails are not being sent, so the customer is not told: let them know yourself."}
          </p>
          {can("packed") ? <ShipNote stock={stock} /> : null}
        </form>
      ) : null}

      {can("delivered") ? (
        <form action={deliveredAction}>
          <Number value={order.number} />
          <SubmitButton pending="Saving" className="bk-btn w-full">
            Mark as delivered
          </SubmitButton>
        </form>
      ) : null}

      {order.status === "packed" ? (
        <form action={packAction}>
          <Number value={order.number} />
          <input type="hidden" name="undo" value="true" />
          <SubmitButton pending="Saving" className="bk-btn bk-btn-quiet w-full">
            Not packed after all
          </SubmitButton>
          <UnpackNote stock={stock} />
        </form>
      ) : null}

      {can("cancelled") ? (
        <details>
          <summary className="label text-pink-deep inline-flex min-h-11 cursor-pointer items-center text-[1.05rem]">
            <span className="cap-trim">Cancel this order</span>
          </summary>
          <form action={cancelAction} className="mt-2 flex flex-col gap-3">
            <Number value={order.number} />
            <div>
              <label htmlFor="cancel-reason" className="field-label">
                Why
              </label>
              <input
                id="cancel-reason"
                name="reason"
                required
                maxLength={280}
                className="field"
              />
            </div>
            <CancelRestock stock={stock} />
            <SubmitButton
              pending="Cancelling"
              className="bk-btn bk-btn-pink w-full"
            >
              Cancel the order
            </SubmitButton>
            <p className="bk-muted text-[0.9375rem] leading-snug">
              {emailing
                ? "The customer is emailed that it is cancelled. If they have paid, the email says their payment is coming back, so record the refund below as well. If they had not paid yet, their payment page is closed so they cannot pay for it afterwards."
                : "If they have paid, record the refund below as well. If they had not paid yet, their payment page is closed so they cannot pay for it afterwards. Nothing is emailed to them: let them know yourself."}
            </p>
          </form>
        </details>
      ) : null}
    </div>
  );
}

export default async function OrderPage({
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

  let order: OrderDetail;
  try {
    order = await execute(
      getOrder,
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

  const history = await execute(
    listActivity,
    { entityType: "order", entityId: order.id, limit: 100 },
    caller,
  );
  const stock = await execute(orderStock, { number: order.number }, caller);
  const emails = await execute(
    listOrderEmails,
    { number: order.number },
    caller,
  );
  // Whether email really leaves from here, read from the same place the
  // outbox reads it. A test order's customer is never emailed.
  const mail = mailConnection();
  const emailing = mail.delivers && !order.isTest;
  const emailLead = order.isTest
    ? "A test order: what would be sent is written down here, and not sent."
    : mail.delivers
      ? `Emails about this order go to ${order.email} as it moves along.`
      : `Nothing is being emailed. ${mail.problem ?? mail.held ?? ""} What would have gone is written down here.`;
  const canWrite = staff.role !== "viewer";
  const editable = ["pending", "paid", "packed"].includes(order.status);
  const refundable =
    canWrite &&
    order.paymentStatus !== "unpaid" &&
    order.paymentStatus !== "failed" &&
    order.paymentStatus !== "review" &&
    order.refundedCents < order.totalCents;
  const byStripe = refundsThroughStripe(order);
  const name = `${order.firstName} ${order.lastName}`.trim();

  return (
    <>
      <PageHeader
        title={order.number}
        back={{ href: "/backstage/orders", label: "Orders" }}
        lead={`Placed ${formatNzDateTime(order.placedAt)}`}
        actions={
          <Link
            href={`/backstage/orders/${order.number}/slip`}
            className="bk-btn bk-btn-quiet"
          >
            <span className="cap-trim">Packing slip</span>
          </Link>
        }
      />

      <p className="-mt-3 mb-5 flex flex-wrap items-center gap-2">
        <OrderStatusPill status={order.status} />
        <PaymentPill status={order.paymentStatus} />
        <TestPill show={order.isTest} />
        {order.mode === "preorder" ? <Pill>Pre-order</Pill> : null}
        {order.rural ? <Pill>Rural</Pill> : null}
      </p>

      {notice ? (
        <div className="mb-4">
          <Notice tone={tone === "bad" ? "bad" : "good"}>{notice}</Notice>
        </div>
      ) : null}
      {order.isTest ? (
        <div className="mb-4">
          <Notice>
            A test order. Nobody was charged, so there is nothing to send.
          </Notice>
        </div>
      ) : null}
      {order.paymentStatus === "review" ? (
        <div className="mb-4">
          <Notice tone="bad">
            Money arrived for this order that does not match it: the amount or
            the currency is different. It has not been marked as paid. Look the
            payment up in Stripe by this order number, then either refund it
            there or settle the difference with the customer. The details are in
            the history below.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Panel title="What is in it" flush>
            <div className="bk-table-wrap">
              <table className="bk-table">
                <thead>
                  <tr>
                    <th scope="col">Pack</th>
                    <th scope="col" className="bk-num">
                      Packs
                    </th>
                    <th scope="col" className="bk-num">
                      Shots
                    </th>
                    <th scope="col" className="bk-num">
                      Price
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <span className="font-semibold">{line.name}</span>
                        <span className="bk-muted block text-[0.875rem]">
                          {line.sku}
                        </span>
                      </td>
                      <td className="bk-num">{line.qty}</td>
                      <td className="bk-num">{line.qty * line.shots}</td>
                      <td className="bk-num">
                        {formatNzdExact(line.lineCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="bk-kv border-navy border-t-2 px-3 py-3">
              <dt>Shots to pack</dt>
              <dd className="bk-num font-semibold">{order.shots}</dd>
              <dt>Subtotal</dt>
              <dd className="bk-num">{formatNzdExact(order.subtotalCents)}</dd>
              {order.promoCode !== null ? (
                <>
                  <dt>
                    {order.bySpecial ? "Special" : "Code"} {order.promoCode}
                  </dt>
                  <dd className="bk-num">
                    {order.discountCents > 0
                      ? `-${formatNzdExact(order.discountCents)}`
                      : "Off delivery"}
                  </dd>
                </>
              ) : null}
              <dt>Delivery</dt>
              <dd className="bk-num">
                {order.shippingCents === 0
                  ? "Free"
                  : formatNzdExact(order.shippingCents)}
              </dd>
              <dt>Total</dt>
              <dd className="bk-num font-semibold">
                {formatNzdExact(order.totalCents)}
              </dd>
              {order.refundedCents > 0 ? (
                <>
                  <dt>Given back</dt>
                  <dd className="bk-num">
                    {formatNzdExact(order.refundedCents)}
                  </dd>
                </>
              ) : null}
              {order.source?.via ? (
                <>
                  <dt>Came through</dt>
                  <dd className="bk-num font-mono [overflow-wrap:anywhere]">
                    /go/{order.source.via}
                  </dd>
                </>
              ) : null}
              {order.partnerId !== null ? (
                <>
                  <dt>Counted for</dt>
                  <dd className="bk-num">
                    <Link
                      href={`/backstage/marketing/partners/${order.partnerId}`}
                      className="underline"
                    >
                      {order.partnerName ?? "A partner"}
                    </Link>
                    {order.commissionPercent > 0 ? (
                      <span className="bk-muted block text-[0.875rem]">
                        {order.isTest
                          ? `A test order, so their ${String(order.commissionPercent)}% cut earns nothing`
                          : `Their ${String(order.commissionPercent)}% cut: ${formatNzdExact(order.cutCents)}`}
                      </span>
                    ) : null}
                  </dd>
                </>
              ) : null}
            </dl>
          </Panel>

          <OrderStockPanel
            number={order.number}
            status={order.status}
            stock={stock}
            canWrite={canWrite}
          />

          <Emails
            number={order.number}
            emails={emails}
            lead={emailLead}
            canWrite={canWrite}
          />

          <Panel title="History" flush>
            <div id="history" className="scroll-mt-24">
              <ActivityList lines={history} now={now} />
            </div>
            {canWrite ? (
              <form
                action={noteAction}
                className="border-navy-line flex flex-wrap items-end gap-2 border-t p-4"
              >
                <Number value={order.number} />
                <div className="min-w-0 flex-1 basis-56">
                  <label htmlFor="note" className="field-label">
                    Add a note
                  </label>
                  <input
                    id="note"
                    name="note"
                    required
                    maxLength={1000}
                    placeholder="Only staff see this"
                    className="field"
                  />
                </div>
                <SubmitButton pending="Adding" className="bk-btn bk-btn-quiet">
                  Add note
                </SubmitButton>
              </form>
            ) : null}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Next step">
            <NextStep
              order={order}
              canWrite={canWrite}
              stock={stock}
              emailing={emailing}
            />
          </Panel>

          <Panel title="Who and where">
            <dl className="bk-kv">
              <dt>Name</dt>
              <dd>
                {order.customerId ? (
                  <Link
                    href={`/backstage/customers/${order.customerId}`}
                    className="link"
                  >
                    {name}
                  </Link>
                ) : (
                  name
                )}
              </dd>
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${order.email}`} className="link">
                  {order.email}
                </a>
              </dd>
              {order.phone ? (
                <>
                  <dt>Phone</dt>
                  <dd>
                    <a
                      href={`tel:${order.phone.replace(/\s/g, "")}`}
                      className="link"
                    >
                      {order.phone}
                    </a>
                  </dd>
                </>
              ) : null}
              <dt>Send to</dt>
              <dd>
                {order.line1}
                {order.line2 ? (
                  <span className="block">{order.line2}</span>
                ) : null}
                {order.suburb ? (
                  <span className="block">{order.suburb}</span>
                ) : null}
                <span className="block">
                  {order.city} {order.postcode}
                </span>
                <span className="block">{order.region}</span>
              </dd>
              {order.deliveryNotes ? (
                <>
                  <dt>Courier note</dt>
                  <dd>{order.deliveryNotes}</dd>
                </>
              ) : null}
              {order.trackingNumber || order.carrier ? (
                <>
                  <dt>Tracking</dt>
                  <dd>
                    {order.carrier ? `${order.carrier} ` : ""}
                    {order.trackingUrl ? (
                      <a
                        href={order.trackingUrl}
                        className="link"
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {order.trackingNumber ?? "Track it"}
                      </a>
                    ) : (
                      order.trackingNumber
                    )}
                  </dd>
                </>
              ) : null}
            </dl>

            {canWrite && editable ? (
              <details className="mt-4">
                <summary className="label inline-flex min-h-11 cursor-pointer items-center text-[1.05rem]">
                  <span className="cap-trim">Change the address</span>
                </summary>
                <form
                  action={addressAction}
                  className="mt-2 flex flex-col gap-3"
                >
                  <Number value={order.number} />
                  <div>
                    <label htmlFor="line1" className="field-label">
                      Street address
                    </label>
                    <input
                      id="line1"
                      name="line1"
                      required
                      defaultValue={order.line1}
                      className="field"
                    />
                  </div>
                  <div>
                    <label htmlFor="line2" className="field-label">
                      Flat, unit or business
                    </label>
                    <input
                      id="line2"
                      name="line2"
                      defaultValue={order.line2 ?? ""}
                      className="field"
                    />
                  </div>
                  <div>
                    <label htmlFor="suburb" className="field-label">
                      Suburb
                    </label>
                    <input
                      id="suburb"
                      name="suburb"
                      defaultValue={order.suburb ?? ""}
                      className="field"
                    />
                  </div>
                  <div>
                    <label htmlFor="city" className="field-label">
                      Town or city
                    </label>
                    <input
                      id="city"
                      name="city"
                      required
                      defaultValue={order.city}
                      className="field"
                    />
                  </div>
                  <div>
                    <label htmlFor="region" className="field-label">
                      Region
                    </label>
                    <select
                      id="region"
                      name="region"
                      defaultValue={order.region}
                      className="field"
                    >
                      {NZ_REGIONS.map((region) => (
                        <option key={region} value={region}>
                          {region}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="postcode" className="field-label">
                      Postcode
                    </label>
                    <input
                      id="postcode"
                      name="postcode"
                      required
                      inputMode="numeric"
                      defaultValue={order.postcode}
                      className="field"
                    />
                  </div>
                  <div>
                    <label htmlFor="deliveryNotes" className="field-label">
                      Note for the courier
                    </label>
                    <input
                      id="deliveryNotes"
                      name="deliveryNotes"
                      defaultValue={order.deliveryNotes ?? ""}
                      className="field"
                    />
                  </div>
                  <SubmitButton
                    pending="Saving"
                    className="bk-btn bk-btn-quiet w-full"
                  >
                    Save the address
                  </SubmitButton>
                </form>
              </details>
            ) : null}
          </Panel>

          <Panel title="Money">
            <dl className="bk-kv">
              <dt>Paid by</dt>
              <dd>
                {order.paymentProvider === "test"
                  ? "Nobody: test mode"
                  : order.paymentProvider}
              </dd>
              {order.paymentReference ? (
                <>
                  <dt>Reference</dt>
                  <dd className="font-mono text-[0.875rem]">
                    {order.paymentReference}
                  </dd>
                </>
              ) : null}
              {order.paidAt ? (
                <>
                  <dt>{order.isTest ? "Recorded" : "Paid"}</dt>
                  <dd>{formatNzDateTime(order.paidAt)}</dd>
                </>
              ) : null}
            </dl>
            {order.refunds.length > 0 ? (
              <ul className="border-navy-line mt-3 flex flex-col gap-1 border-t pt-3 text-[0.9688rem]">
                {order.refunds.map((refund) => (
                  <li key={refund.id}>
                    <span className="font-semibold">
                      {formatNzd(refund.amountCents)}
                    </span>{" "}
                    {refund.status === "pending"
                      ? "on its way back"
                      : refund.status === "failed"
                        ? "did not go back (see the history)"
                        : "given back"}
                    : {refund.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            {refundable ? (
              <details className="mt-3">
                <summary className="label inline-flex min-h-11 cursor-pointer items-center text-[1.05rem]">
                  <span className="cap-trim">
                    {byStripe ? "Refund" : "Record a refund"}
                  </span>
                </summary>
                <form
                  action={refundAction}
                  className="mt-2 flex flex-col gap-3"
                >
                  <Number value={order.number} />
                  <div>
                    <label htmlFor="amount" className="field-label">
                      How much
                    </label>
                    <input
                      id="amount"
                      name="amount"
                      required
                      inputMode="decimal"
                      placeholder={`Up to ${formatNzdExact(order.totalCents - order.refundedCents)}`}
                      className="field"
                    />
                  </div>
                  <div>
                    <label htmlFor="refund-reason" className="field-label">
                      Why
                    </label>
                    <input
                      id="refund-reason"
                      name="reason"
                      required
                      maxLength={280}
                      className="field"
                    />
                  </div>
                  <SubmitButton
                    pending="Recording"
                    className="bk-btn bk-btn-quiet w-full"
                  >
                    {byStripe ? "Send the refund" : "Record the refund"}
                  </SubmitButton>
                  <p className="bk-muted text-[0.9375rem] leading-snug">
                    {byStripe
                      ? emailing
                        ? "This sends the money back to the customer's card through Stripe, and emails them once it is on its way. Their bank can take a few days to show it."
                        : "This sends the money back to the customer's card through Stripe. Their bank can take a few days to show it. Nothing is emailed to them: let them know yourself."
                      : "This only writes the refund down. The money itself has to be sent back by hand, and nothing is emailed to the customer."}
                  </p>
                </form>
              </details>
            ) : null}
          </Panel>
        </div>
      </div>
    </>
  );
}
