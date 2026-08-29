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

export const metadata: Metadata = {
  title: "Orders & Delivery",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Orders & Delivery.
 *
 * Reading is real: every order, its contents, its destination and its state
 * come through the commerce adapter, so this page works the same the day the
 * shop moves from the local mirror to Shopify. Acting on an order — packing
 * it, printing a label, refunding it — is not built, and the page says so
 * rather than drawing a button that lies.
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
  const params = await searchParams;
  const raw = params["q"];
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";

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
    return { pack, transit, recent, week, found, now };
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

  const { pack, transit, recent, week, found } = result.data;
  const unpaid = pack.filter((order) => order.financialStatus !== "paid");

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
                <OrderTable orders={found} />
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
          works={[
            "Every order read live through the commerce adapter, so it reads the same against Shopify",
            "The pack queue, ordered oldest first, with the note the customer left",
            "Tracking numbers for anything already posted",
            "Search by order number or email, in a link you can bookmark",
          ]}
          coming={[
            "Marking an order packed, and printing a pack sheet",
            "Buying and printing a courier label from here",
            "Refunds and cancellations",
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
