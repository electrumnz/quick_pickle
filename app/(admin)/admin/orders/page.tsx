import type { Metadata } from "next";

import type { Order } from "@/lib/commerce";

import {
  between,
  ordersInTransit,
  ordersSince,
  ordersToPack,
  recentOrders,
  searchOrders,
  summarise,
} from "@/components/admin/data/commerce-reads";
import { load } from "@/components/admin/data/db";
import {
  ago,
  day,
  money,
  moneyRound,
  plural,
  waiting,
} from "@/components/admin/data/format";
import {
  DataUnavailable,
  NotBuiltYet,
  PageHeader,
  PageSections,
  Section,
} from "@/components/admin/ui/page";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Row,
  Rows,
  Stat,
  StatGrid,
  TableScroll,
  Td,
  Th,
} from "@/components/admin/ui/primitives";
import { FilterNotice, SearchForm } from "@/components/admin/ui/search-form";
import { Flash } from "@/components/admin/write/flash";
import { requireAdminSession } from "@/lib/auth/server";

import { refundTotals, refundsFor, type RecordedRefund } from "./data";
import { OrderRisks, PackForm, TrackingForm } from "./order-forms";
import { REFUND_WORDS } from "./words";

export const metadata: Metadata = {
  title: "Orders & Delivery",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Orders & Delivery.
 *
 * Reading is real: every order, its contents, its destination and its state
 * come through the commerce adapter, so this page works the same the day the
 * shop moves from the local mirror to Shopify. So is acting on one. Packing an
 * order and putting its ticket number on it are `fulfillmentCreate` through
 * that same adapter; cancelling is `orderCancel`, and the bottles really do go
 * back on the shelf.
 *
 * The pack form sits open on every row in the queue rather than behind a fold,
 * because a twenty-order morning is twenty repetitions of the same three
 * keystrokes and this page is meant to be clearable without leaving it.
 *
 * A refund is the one thing here that is written down rather than carried out,
 * and the screen says so every time it is offered: no payment gateway is wired
 * to this deployment, so the record is real and the money has not moved.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const FULFILMENT_WORDS: Readonly<Record<string, string>> = {
  unfulfilled: "To pack",
  partially_fulfilled: "Part sent",
  fulfilled: "On its way",
  delivered: "Delivered",
  returned: "Came back",
  cancelled: "Cancelled",
};

const PAYMENT_WORDS: Readonly<Record<string, string>> = {
  pending: "Not paid yet",
  authorized: "Payment held",
  paid: "Paid",
  partially_refunded: "Part refunded",
  refunded: "Refunded",
  voided: "Payment voided",
};

function who(order: Order): string {
  return order.customer?.displayName ?? order.email;
}

function place(order: Order): string {
  const address = order.shippingAddress;
  if (address === null) return "No address";
  const company = address.company;
  const city = address.city;
  return company === null || company === undefined
    ? city
    : `${company}, ${city}`;
}

function bottles(order: Order): number {
  return order.lineItems.reduce((sum, line) => sum + line.quantity, 0);
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { csrfToken } = await requireAdminSession();
  const params = await searchParams;
  const raw = params["q"];
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const back =
    query === ""
      ? "/admin/orders"
      : `/admin/orders?q=${encodeURIComponent(query)}`;

  const result = await load(async () => {
    const now = new Date();
    const [pack, transit, recent, window_, found] = await Promise.all([
      ordersToPack(25),
      ordersInTransit(6),
      recentOrders(25),
      ordersSince(new Date(now.getTime() - 30 * DAY_MS)),
      query === "" ? Promise.resolve([]) : searchOrders(query, 25),
    ]);
    const week = summarise(
      between(window_, new Date(now.getTime() - 7 * DAY_MS), now),
    );
    const shown = [...pack, ...transit, ...recent, ...found];
    const [refunds, refunded] = await Promise.all([
      refundsFor([...new Set(shown.map((order) => order.id))]),
      refundTotals(30),
    ]);
    return { pack, transit, recent, week, found, now, refunds, refunded };
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="Orders & Delivery"
          lede="Every order, what is in it, and where it is going."
        />
        <DataUnavailable problem={result.problem} detail={result.detail} />
      </>
    );
  }

  const { pack, transit, recent, week, found, refunds, refunded } = result.data;
  const unpaid = pack.filter((order) => order.financialStatus !== "paid");

  /** What is left to give back on an order: the total, less anything already. */
  const refundable = (order: Order): number =>
    order.total.amountInMinorUnits -
    order.refundedTotal.amountInMinorUnits -
    (refunds.get(order.id) ?? []).reduce(
      (sum, one) => sum + one.amountCents,
      0,
    );

  return (
    <>
      <PageHeader
        title="Orders & Delivery"
        lede="Every order, what is in it, where it is going, and whether it has been packed and posted."
        actions={
          <SearchForm
            action="/admin/orders"
            value={query}
            placeholder="Order number or email"
            label="Search orders"
          />
        }
      />

      <PageSections>
        <Flash searchParams={params} />

        <Section title="Where things stand">
          <div className="rounded-lg border border-hairline bg-surface-raised px-4 py-4">
            <StatGrid>
              <Stat
                label="Waiting to be packed"
                value={String(pack.length)}
                hint={
                  unpaid.length === 0
                    ? "All paid for and ready to go"
                    : `${plural(unpaid.length, "order")} not paid for yet`
                }
                tone={pack.length > 0 ? "danger" : "neutral"}
              />
              <Stat
                label="On the way"
                value={String(transit.length)}
                hint="Packed and handed to a courier"
              />
              <Stat
                label="Orders, last 7 days"
                value={String(week.orders)}
                hint={`${plural(week.units, "bottle")} sold`}
              />
              <Stat
                label="Money in, last 7 days"
                value={moneyRound(week.takingsCents)}
                hint="GST included"
              />
              <Stat
                label="Owed back, last 30 days"
                value={moneyRound(refunded.cents)}
                hint={
                  refunded.count === 0
                    ? "Nothing has been refunded"
                    : `${plural(refunded.unsettledCount, "refund")} still to pay out — ${moneyRound(refunded.unsettledCents)}`
                }
                tone={refunded.unsettledCount > 0 ? "danger" : "neutral"}
              />
            </StatGrid>
          </div>
        </Section>

        {query !== "" && (
          <Section
            title={`Search results`}
            description="Matched on order number and customer email."
          >
            <Card>
              <CardHeader
                title={`Matches for “${query}”`}
                count={found.length}
              />
              {found.length === 0 ? (
                <EmptyState
                  headline={`Nothing matches “${query}”`}
                  fills="Try an order number like HS-01092, or the email address the customer used."
                >
                  Order search looks at the order number and the email on the
                  order. Customer names live in Customers & Marketing.
                </EmptyState>
              ) : (
                <Rows>
                  {found.map((order) => (
                    <Row key={order.id}>
                      <OrderLine order={order} />
                      <RefundNote refunds={refunds.get(order.id) ?? []} />
                      {order.fulfillmentStatus === "unfulfilled" &&
                        order.status !== "cancelled" && (
                          <PackForm
                            order={order}
                            csrfToken={csrfToken}
                            back={back}
                            scope="found"
                          />
                        )}
                      <OrderRisks
                        order={order}
                        csrfToken={csrfToken}
                        back={back}
                        refundableCents={refundable(order)}
                        scope="found"
                      />
                    </Row>
                  ))}
                </Rows>
              )}
              <div className="border-t border-hairline px-4 py-3">
                <FilterNotice
                  query={query}
                  found={found.length}
                  clearHref="/admin/orders"
                  noun="order"
                />
              </div>
            </Card>
          </Section>
        )}

        <Section
          title="To pack"
          description="Oldest first. An order that has not been paid for is here so you can see it, not so you can send it."
        >
          <Card>
            {pack.length === 0 ? (
              <EmptyState
                headline="Everything is packed"
                fills="A paid order appears here within seconds of the customer checking out."
              >
                This is the queue of orders that still need to go in a box.
              </EmptyState>
            ) : (
              <Rows>
                {pack.map((order) => (
                  <Row key={order.id}>
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-body-sm font-medium text-primary">
                          {who(order)}
                          {order.financialStatus !== "paid" && (
                            <Badge tone="danger">
                              {PAYMENT_WORDS[order.financialStatus] ??
                                order.financialStatus}
                            </Badge>
                          )}
                        </p>
                        <p className="mt-0.5 text-caption text-muted">
                          {order.lineItems
                            .map(
                              (line) =>
                                `${String(line.quantity)} × ${line.title}`,
                            )
                            .join(", ")}
                        </p>
                        <p className="mt-1 text-caption text-muted">
                          {place(order)} · {order.orderNumber} ·{" "}
                          {waiting(order.placedAt)}
                          {order.shippingMethod === null
                            ? ""
                            : ` · ${order.shippingMethod}`}
                        </p>
                        {order.customerNote !== null && (
                          <p className="mt-1 text-caption text-primary">
                            Note from the customer: {order.customerNote}
                          </p>
                        )}
                      </div>
                      <p className="shrink-0 text-body-sm text-primary tabular-nums">
                        {money(order.total.amountInMinorUnits)}
                      </p>
                    </div>
                    <RefundNote refunds={refunds.get(order.id) ?? []} />
                    <PackForm
                      order={order}
                      csrfToken={csrfToken}
                      back={back}
                      scope="pack"
                    />
                    <OrderRisks
                      order={order}
                      csrfToken={csrfToken}
                      back={back}
                      refundableCents={refundable(order)}
                      scope="pack"
                    />
                  </Row>
                ))}
              </Rows>
            )}
          </Card>
        </Section>

        {transit.length > 0 && (
          <Section
            title="On the way"
            description="Packed and posted. The tracking number is what a customer is asking for when they email."
          >
            <Card>
              <Rows>
                {transit.map((order) => (
                  <Row key={order.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-body-sm text-primary">
                        {who(order)} · {place(order)}
                      </p>
                      <p className="text-caption text-muted tabular-nums">
                        {money(order.total.amountInMinorUnits)}
                      </p>
                    </div>
                    <p className="mt-0.5 text-caption text-muted">
                      {order.orderNumber} · sent{" "}
                      {order.fulfilledAt === null
                        ? "recently"
                        : ago(order.fulfilledAt)}
                      {order.tracking === null
                        ? ""
                        : ` · ${order.tracking.carrier} ${order.tracking.number}`}
                    </p>
                    <RefundNote refunds={refunds.get(order.id) ?? []} />
                    <div className="mt-3">
                      <TrackingForm
                        order={order}
                        csrfToken={csrfToken}
                        back={back}
                        scope="transit"
                      />
                    </div>
                    <OrderRisks
                      order={order}
                      csrfToken={csrfToken}
                      back={back}
                      refundableCents={refundable(order)}
                      scope="transit"
                    />
                  </Row>
                ))}
              </Rows>
            </Card>
          </Section>
        )}

        <Section
          title="Everything recent"
          description="The last twenty-five orders, newest first."
        >
          <Card>
            {/* A phone gets the same orders as a list, because the columns
                that matter — who, how much, what state — are the ones a table
                pushes off the side of a 375px screen. */}
            <div className="hidden md:block">
              <OrderTable orders={recent} />
            </div>
            <div className="md:hidden">
              <Rows>
                {recent.map((order) => (
                  <Row key={order.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-body-sm font-medium text-primary">
                        {who(order)}
                      </p>
                      <p className="text-body-sm text-primary tabular-nums">
                        {money(order.total.amountInMinorUnits)}
                      </p>
                    </div>
                    <p className="mt-0.5 text-caption text-muted">
                      {order.orderNumber} · {place(order)} ·{" "}
                      {plural(bottles(order), "bottle")}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge
                        tone={
                          order.fulfillmentStatus === "unfulfilled"
                            ? "quiet"
                            : "neutral"
                        }
                      >
                        {FULFILMENT_WORDS[order.fulfillmentStatus] ??
                          order.fulfillmentStatus}
                      </Badge>
                      {order.financialStatus !== "paid" && (
                        <Badge tone="danger">
                          {PAYMENT_WORDS[order.financialStatus] ??
                            order.financialStatus}
                        </Badge>
                      )}
                      <span className="text-caption text-muted">
                        {day(order.placedAt)}
                      </span>
                    </p>
                  </Row>
                ))}
              </Rows>
            </div>
          </Card>
        </Section>

        <NotBuiltYet
          blurb="This page changes real things. Packing an order, putting a ticket number on it and cancelling one all go through the same commerce adapter the shop runs on, and cancelling really does put the bottles back on the shelf. A refund is the exception and says so where it is offered: it is written down here, and the money still has to be moved by you."
          works={[
            "Every order read live through the commerce adapter, so it reads the same against Shopify",
            "Marking an order packed and posted, with the courier and the ticket number",
            "Changing a ticket number that went on wrong",
            "Cancelling an order, with the choice to put the bottles back on the shelf",
            "Recording a refund against an order, in whole cents, with the reason",
            "Search by order number or email, in a link you can bookmark — and every match can be acted on",
          ]}
          coming={[
            "Actually moving the money: no payment gateway is connected, so a refund here is a record, not a payment",
            "Buying and printing a courier label — nothing in this admin can book a courier",
            "A pack sheet to print for the bench",
            "One page per order, and one per customer",
          ]}
        />
      </PageSections>
    </>
  );
}

function OrderTable({ orders }: { orders: readonly Order[] }) {
  return (
    <TableScroll>
      <thead>
        <tr>
          <Th>Order</Th>
          <Th>Customer</Th>
          <Th>Going to</Th>
          <Th numeric>Bottles</Th>
          <Th numeric>Total</Th>
          <Th>State</Th>
          <Th>Placed</Th>
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr key={order.id}>
            <Td className="whitespace-nowrap">{order.orderNumber}</Td>
            <Td>{who(order)}</Td>
            <Td>{place(order)}</Td>
            <Td numeric>{bottles(order)}</Td>
            <Td numeric>{money(order.total.amountInMinorUnits)}</Td>
            <Td>
              <span className="flex flex-wrap gap-1.5">
                <Badge
                  tone={
                    order.fulfillmentStatus === "unfulfilled"
                      ? "quiet"
                      : "neutral"
                  }
                >
                  {FULFILMENT_WORDS[order.fulfillmentStatus] ??
                    order.fulfillmentStatus}
                </Badge>
                {order.financialStatus !== "paid" && (
                  <Badge tone="danger">
                    {PAYMENT_WORDS[order.financialStatus] ??
                      order.financialStatus}
                  </Badge>
                )}
              </span>
            </Td>
            <Td className="whitespace-nowrap">{day(order.placedAt)}</Td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
}

/** Who, where, what and how much — the four facts every order row opens with. */
function OrderLine({ order }: { order: Order }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-body-sm font-medium text-primary">
          {who(order)}
          <Badge
            tone={
              order.fulfillmentStatus === "unfulfilled" ? "quiet" : "neutral"
            }
          >
            {FULFILMENT_WORDS[order.fulfillmentStatus] ??
              order.fulfillmentStatus}
          </Badge>
          {order.financialStatus !== "paid" && (
            <Badge tone="danger">
              {PAYMENT_WORDS[order.financialStatus] ?? order.financialStatus}
            </Badge>
          )}
        </p>
        <p className="mt-0.5 text-caption text-muted">
          {order.lineItems
            .map((line) => `${String(line.quantity)} × ${line.title}`)
            .join(", ")}
        </p>
        <p className="mt-1 text-caption text-muted">
          {order.orderNumber} · {place(order)} · {day(order.placedAt)}
          {order.tracking === null
            ? ""
            : ` · ${order.tracking.carrier} ${order.tracking.number}`}
        </p>
      </div>
      <p className="shrink-0 text-body-sm text-primary tabular-nums">
        {money(order.total.amountInMinorUnits)}
      </p>
    </div>
  );
}

/**
 * What has been promised back on this order, and whether it has been paid.
 *
 * The second half of that sentence is the whole reason this exists: a refund
 * recorded in this admin has not left anyone's bank, and a screen that showed
 * only "refunded $18.00" would let her think a customer had been paid.
 */
function RefundNote({ refunds }: { refunds: readonly RecordedRefund[] }) {
  if (refunds.length === 0) return null;
  const owed = refunds
    .filter((refund) => refund.settledAt === null)
    .reduce((sum, refund) => sum + refund.amountCents, 0);
  return (
    <p className="mt-2 text-caption text-danger">
      {refunds
        .map(
          (refund) =>
            `${money(refund.amountCents)} — ${(REFUND_WORDS[refund.reason] ?? refund.reason).toLowerCase()}, ${ago(refund.decidedAt)}`,
        )
        .join(" · ")}
      {owed > 0
        ? `. ${money(owed)} of that is written down and not yet paid out.`
        : "."}
    </p>
  );
}
