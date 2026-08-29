import type { Metadata } from "next";

import { NZ_GST_BASIS_POINTS, taxIncludedInTotal } from "@/lib/commerce";

import {
  between,
  ordersSince,
  summarise,
  weeklyTakings,
} from "@/components/admin/data/commerce-reads";
import { allProducts } from "@/components/admin/data/commerce-reads";
import { load } from "@/components/admin/data/db";
import {
  money,
  moneyRound,
  percent,
  plural,
} from "@/components/admin/data/format";
import {
  agentSpend,
  purchaseOrders,
  recentBatches,
} from "@/components/admin/data/queries";
import { TakingsStrip } from "@/components/admin/ui/bars";
import {
  DataUnavailable,
  NotBuiltYet,
  PageHeader,
  PageSections,
  Section,
} from "@/components/admin/ui/page";
import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Row,
  Rows,
  Stat,
  StatGrid,
  TableScroll,
  Td,
  Th,
} from "@/components/admin/ui/primitives";

export const metadata: Metadata = {
  title: "Money",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Money.
 *
 * Written for someone who is not an accountant and should not have to become
 * one. Three rules: every figure says whether GST is inside it, "takings" is
 * used rather than "revenue" because takings is what arrives in the bank, and
 * the margin table shows its own arithmetic rather than asking her to trust a
 * percentage.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function MoneyPage() {
  const result = await load(async () => {
    const now = new Date();
    const [orders, batches, spend, po, products] = await Promise.all([
      ordersSince(new Date(now.getTime() - 120 * DAY_MS)),
      recentBatches(20),
      agentSpend(),
      purchaseOrders(10),
      allProducts(),
    ]);
    return { orders, batches, spend, po, products, now };
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="Money"
          lede="Takings, GST, what each bottle costs to make, and what the AI team is spending."
        />
        <DataUnavailable problem={result.problem} detail={result.detail} />
      </>
    );
  }

  const { orders, batches, spend, po, products, now } = result.data;
  const week = summarise(
    between(orders, new Date(now.getTime() - 7 * DAY_MS), now),
  );
  const month = summarise(
    between(orders, new Date(now.getTime() - 30 * DAY_MS), now),
  );
  const quarter = summarise(
    between(orders, new Date(now.getTime() - 90 * DAY_MS), now),
  );
  const weeks = weeklyTakings(orders, 12, now);

  const discounts = between(orders, new Date(now.getTime() - 90 * DAY_MS), now)
    .filter((order) => order.status !== "cancelled")
    .reduce((sum, order) => sum + order.discountTotal.amountInMinorUnits, 0);
  const refunds = between(
    orders,
    new Date(now.getTime() - 90 * DAY_MS),
    now,
  ).reduce((sum, order) => sum + order.refundedTotal.amountInMinorUnits, 0);
  const owedToSuppliers = po
    .filter((order) => order.receivedAt === null && order.status === "ordered")
    .reduce((sum, order) => sum + order.totalCents, 0);

  // Cost per bottle: the most recent released batch of each product.
  const costBySku = new Map<string, { cost: number; batch: string }>();
  for (const batch of batches) {
    if (batch.unitCostCents === 0 || batch.productTitle === null) continue;
    if (!costBySku.has(batch.productTitle)) {
      costBySku.set(batch.productTitle, {
        cost: batch.unitCostCents,
        batch: batch.code,
      });
    }
  }

  const margins = products.map((product) => {
    const variant = product.variants[0];
    const price = variant?.price.amountInMinorUnits ?? 0;
    const gst = taxIncludedInTotal(price, NZ_GST_BASIS_POINTS);
    const exGst = price - gst;
    const made = costBySku.get(product.title);
    const cost = made?.cost ?? 0;
    return {
      id: product.id,
      title: product.title,
      sku: variant?.sku ?? "",
      price,
      exGst,
      cost,
      batch: made?.batch ?? null,
      margin: exGst === 0 || cost === 0 ? null : (exGst - cost) / exGst,
    };
  });

  return (
    <>
      <PageHeader
        title="Money"
        lede="What came in, what is owed, and what each bottle costs to make. Every figure is in New Zealand dollars."
        meta={
          <span>Prices include GST at 15% unless a figure says otherwise</span>
        }
      />

      <PageSections>
        <Section title="Money in">
          <div className="rounded-lg border border-hairline bg-surface-raised px-4 py-4">
            <StatGrid>
              <Stat
                label="Last 7 days"
                value={moneyRound(week.takingsCents)}
                hint={`${plural(week.orders, "order")}, ${plural(week.units, "bottle")}`}
              />
              <Stat
                label="Last 30 days"
                value={moneyRound(month.takingsCents)}
                hint={`${plural(month.orders, "order")} · average ${money(month.averageOrderCents)}`}
              />
              <Stat
                label="Last 90 days"
                value={moneyRound(quarter.takingsCents)}
                hint={`${plural(quarter.orders, "order")}`}
              />
              <Stat
                label="GST inside the last 90 days"
                value={moneyRound(quarter.gstCents)}
                hint="Collected on IRD's behalf. It is not income."
              />
            </StatGrid>
          </div>
        </Section>

        <Section
          title="Twelve weeks"
          description="Each bar is one week of takings, GST included. Weeks start on Monday."
        >
          <Card>
            <CardBody>
              <TakingsStrip
                days={weeks.map((entry) => ({
                  date: entry.weekStart,
                  takingsCents: entry.takingsCents,
                  orders: entry.orders,
                }))}
                granularity="week"
              />
            </CardBody>
          </Card>
        </Section>

        <Section
          title="What a bottle costs to make"
          description="Cost comes from the most recent batch of each brine. The margin is worked out on the price without GST, because the GST is never yours."
        >
          <Card>
            <TableScroll>
              <thead>
                <tr>
                  <Th>Brine</Th>
                  <Th numeric>Shelf price</Th>
                  <Th numeric>Price without GST</Th>
                  <Th numeric>Cost to make</Th>
                  <Th numeric>Left over</Th>
                  <Th numeric>Margin</Th>
                </tr>
              </thead>
              <tbody>
                {margins.map((line) => (
                  <tr key={line.id}>
                    <Td>
                      {line.title}
                      {line.batch !== null && (
                        <span className="block text-caption text-muted">
                          costed from batch {line.batch}
                        </span>
                      )}
                    </Td>
                    <Td numeric>{money(line.price)}</Td>
                    <Td numeric>{money(line.exGst)}</Td>
                    <Td numeric>
                      {line.cost === 0 ? "not costed yet" : money(line.cost)}
                    </Td>
                    <Td numeric>
                      {line.cost === 0 ? "—" : money(line.exGst - line.cost)}
                    </Td>
                    <Td numeric>
                      {line.margin === null ? "—" : percent(line.margin, 1)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
            <CardBody className="border-t border-hairline">
              <Callout title="Where these numbers come from">
                The shelf price is what the shop charges. The cost is what the
                last batch of that brine actually cost to make, per bottle,
                including ingredients, labour, packaging and overhead. Nothing
                here includes the cost of posting a bottle to a customer.
              </Callout>
            </CardBody>
          </Card>
        </Section>

        <Section title="Money out, and money owed">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Given away and paid back" />
              <CardBody>
                <StatGrid columns={2}>
                  <Stat
                    label="Discounts, last 90 days"
                    value={moneyRound(discounts)}
                    hint="Taken off orders by a code"
                  />
                  <Stat
                    label="Refunded, last 90 days"
                    value={moneyRound(refunds)}
                    hint="Money returned to customers"
                  />
                  <Stat
                    label="Owed to suppliers"
                    value={moneyRound(owedToSuppliers)}
                    hint="Ordered and not yet arrived"
                  />
                  <Stat
                    label="AI team, this month"
                    value={money(spend.monthCents)}
                    hint={`${money(spend.todayCents)} of it today`}
                  />
                </StatGrid>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Orders placed with suppliers"
                count={po.length}
              />
              <Rows>
                {po.slice(0, 6).map((order) => (
                  <Row key={order.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-body-sm text-primary">
                        {order.supplierName}
                      </p>
                      <p className="text-caption text-primary tabular-nums">
                        {money(order.totalCents)}
                      </p>
                    </div>
                    <p className="mt-0.5 text-caption text-muted">
                      {order.number} ·{" "}
                      {order.receivedAt !== null
                        ? "arrived and paid"
                        : order.status === "pending_approval"
                          ? "waiting on your approval"
                          : "ordered, not yet arrived"}
                    </p>
                  </Row>
                ))}
              </Rows>
            </Card>
          </div>
        </Section>

        <NotBuiltYet
          works={[
            "Takings, GST and averages worked out from real orders through the commerce adapter",
            "Twelve weeks of trading at a glance",
            "Cost a bottle from the real batch costs, and the margin on each brine",
            "What the AI team costs, day and month",
          ]}
          coming={[
            "A GST return period with the figure to file",
            "Expenses and supplier invoices, so this becomes a profit figure rather than a takings figure",
            "Payouts from the payment provider, reconciled against orders",
            "Exporting any of this for the accountant",
          ]}
        />
      </PageSections>
    </>
  );
}
