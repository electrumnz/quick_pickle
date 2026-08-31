import type { Metadata } from "next";

import { load } from "@/components/admin/data/db";
import {
  ago,
  day,
  dayAndTime,
  dayLong,
  money,
  moneyRound,
  plural,
  quantity,
  until,
  waiting,
} from "@/components/admin/data/format";
import {
  loadToday,
  summariseDay,
  type ActionItem,
  type TodayData,
} from "@/components/admin/data/today";
import { TakingsStrip } from "@/components/admin/ui/bars";
import {
  ActionLink,
  DataUnavailable,
  PageHeader,
} from "@/components/admin/ui/page";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Meter,
  Row,
  Rows,
  Stat,
  StatGrid,
} from "@/components/admin/ui/primitives";

export const metadata: Metadata = {
  title: "Today",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Today — the screen that has to tell her what her day is.
 *
 * Everything above the fold is something she can act on. The right-hand rail
 * is the state of the business: takings, what is coming, and what happened
 * while she was away (from `audit_log`).
 */

export default async function TodayPage() {
  const result = await load(() => loadToday());
  const now = new Date();

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="Today"
          lede="Everything waiting on you, in one list."
          meta={<span>{dayLong(now)} · New Zealand time</span>}
        />
        <DataUnavailable problem={result.problem} detail={result.detail} />
      </>
    );
  }

  const data = result.data;

  return (
    <>
      <PageHeader
        title="Today"
        lede={summariseDay(data)}
        meta={
          <>
            <span>{dayLong(now)}</span>
            <span aria-hidden="true">·</span>
            <span>New Zealand time</span>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <NeedsYou actions={data.actions} />
          <ToPack data={data} />
          <StockToday data={data} />
        </div>

        <aside aria-label="Today at a glance" className="space-y-6">
          <BusinessNow data={data} />
          <ComingUp data={data} />
          <WhileAway data={data} />
        </aside>
      </div>
    </>
  );
}

function NeedsYou({ actions }: { actions: readonly ActionItem[] }) {
  const shown = actions.slice(0, 10);
  return (
    <Card>
      <CardHeader
        title="Needs you"
        count={actions.length}
        note="Most urgent first"
      />
      {actions.length === 0 ? (
        <EmptyState
          headline="Nothing is waiting on you"
          fills="Unpaid orders, Mirror troubles, failed posts and reviews that need a reply land here."
        >
          Every order is packed and nothing has failed. This list is where
          anything that needs a human turns up.
        </EmptyState>
      ) : (
        <Rows>
          {shown.map((action) => (
            <ActionRow key={action.id} action={action} />
          ))}
        </Rows>
      )}
      {actions.length > shown.length && (
        <CardBody className="border-t border-hairline">
          <p className="text-caption text-muted">
            {plural(actions.length - shown.length, "more item")} waiting. Each
            one lives in the section named beside it.
          </p>
        </CardBody>
      )}
    </Card>
  );
}

function ActionRow({ action }: { action: ActionItem }) {
  const tone = action.kind === "Not working" ? "danger" : "quiet";
  return (
    <Row href={action.href}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
        <div className="order-2 min-w-0 flex-1 sm:order-1">
          <p className="text-body-sm font-medium text-primary">
            {action.title}
          </p>
          <p className="mt-0.5 line-clamp-2 text-caption text-muted">
            {action.why}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
            <span>{action.source}</span>
            <span aria-hidden="true">·</span>
            <span>{ago(action.occurredAt)}</span>
            {action.amountLabel !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-primary tabular-nums">
                  {action.amountLabel}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="order-1 flex shrink-0 items-center gap-2 sm:order-2">
          <Badge tone={tone}>{action.kind}</Badge>
          <span className="text-caption text-muted">{action.section}</span>
        </div>
      </div>
    </Row>
  );
}

function ToPack({ data }: { data: TodayData }) {
  const oldest = data.toPack[0];
  return (
    <Card>
      <CardHeader
        title="Orders to pack"
        count={data.toPack.length}
        action={{ label: "All orders", href: "/admin/orders" }}
      />
      {data.toPack.length === 0 ? (
        <EmptyState
          headline="Every order has been packed"
          fills="A new order appears here as soon as it is paid for, with the address and the bottles to put in the box."
        >
          This is the pack queue: paid orders that have not been sent yet,
          oldest first.
        </EmptyState>
      ) : (
        <>
          <Rows>
            {data.toPack.slice(0, 6).map((order) => (
              <Row key={order.id}>
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-body-sm font-medium text-primary">
                      {order.customer}
                      {!order.paid && <Badge tone="danger">Not paid yet</Badge>}
                    </p>
                    <p className="mt-0.5 text-caption text-muted">
                      {order.items}
                    </p>
                    <p className="mt-1 text-caption text-muted">
                      {order.destination} · {order.number} ·{" "}
                      {waiting(order.placedAt)}
                    </p>
                  </div>
                  <p className="shrink-0 text-body-sm text-primary tabular-nums">
                    {money(order.totalCents)}
                  </p>
                </div>
              </Row>
            ))}
          </Rows>
          <CardBody className="border-t border-hairline">
            <p className="text-caption text-muted">
              {oldest === undefined
                ? null
                : `The oldest has been ${waiting(oldest.placedAt)}. `}
              {data.awaitingPayment > 0
                ? `${plural(data.awaitingPayment, "order")} here ${data.awaitingPayment === 1 ? "has" : "have"} not been paid for — do not pack ${data.awaitingPayment === 1 ? "it" : "them"} yet.`
                : "All of these are paid for and ready to go."}
            </p>
          </CardBody>
        </>
      )}
    </Card>
  );
}

function StockToday({ data }: { data: TodayData }) {
  const tightest = data.stock[0];
  return (
    <Card>
      <CardHeader
        title="Stock"
        note="Days of cover at the last month's rate"
        action={{ label: "Stock & batches", href: "/admin/stock" }}
      />
      <div className="divide-y divide-hairline">
        <div className="px-4 py-3.5">
          <p className="text-caption text-muted">
            Bottles ready to sell, across the kitchen and the coolstore.
          </p>
          <ul className="mt-3 space-y-3">
            {data.stock.map((line) => {
              const short = line.coverDays !== null && line.coverDays < 21;
              return (
                <li key={line.sku}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-body-sm text-primary">
                      {line.productTitle}
                    </p>
                    <p className="shrink-0 text-caption text-muted tabular-nums">
                      {quantity(line.available)} left
                      {line.coverDays === null
                        ? ""
                        : ` · about ${String(line.coverDays)} days`}
                    </p>
                  </div>
                  <div className="mt-1.5">
                    {line.coverDays === null ? (
                      <p className="text-caption text-muted">
                        Nothing sold in the last month, so there is no rate to
                        judge this by yet.
                      </p>
                    ) : (
                      <Meter
                        value={Math.min(line.coverDays, 90)}
                        max={90}
                        tone={short ? "danger" : "neutral"}
                        label={`${line.productTitle}: about ${String(line.coverDays)} days of stock left, ${quantity(line.available)} bottles ready`}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {tightest !== undefined && tightest.coverDays !== null && (
            <p className="mt-3 text-caption text-muted">
              Tightest is {tightest.productTitle} at about{" "}
              {String(tightest.coverDays)} days. A batch takes about a week from
              the fermenter to the shelf.
            </p>
          )}
        </div>

        <div className="px-4 py-3.5">
          <p className="text-caption text-muted">
            Ingredients and packaging at or under the point you reorder at.
          </p>
          {data.lowIngredients.length === 0 ? (
            <p className="mt-2 text-body-sm text-primary">
              Nothing is low. Every ingredient is above its reorder point.
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {data.lowIngredients.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5"
                >
                  <span className="text-body-sm text-primary">{item.name}</span>
                  <span className="text-caption text-muted tabular-nums">
                    {quantity(item.stockOnHand, item.unit)} left, reorder at{" "}
                    {quantity(item.reorderPoint, item.unit)}
                  </span>
                  <span className="w-full text-caption text-muted">
                    {item.supplierName ?? "No preferred supplier"}
                    {item.supplierLeadDays === null
                      ? ""
                      : ` · ${plural(item.supplierLeadDays, "day")} to arrive`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {data.batches.length > 0 && (
          <div className="px-4 py-3.5">
            <p className="text-caption text-muted">Being made right now.</p>
            <ul className="mt-2.5 space-y-2">
              {data.batches.map((batch) => (
                <li
                  key={batch.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5"
                >
                  <span className="text-body-sm text-primary">
                    {batch.productTitle ?? batch.code} —{" "}
                    {batch.status.replace(/_/g, " ")}
                  </span>
                  <span className="text-caption text-muted">
                    {batch.code}
                    {batch.plannedFor === null
                      ? ""
                      : ` · started ${day(batch.plannedFor)}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function BusinessNow({ data }: { data: TodayData }) {
  const change =
    data.previousWeek.takingsCents === 0
      ? null
      : Math.round(
          ((data.week.takingsCents - data.previousWeek.takingsCents) /
            data.previousWeek.takingsCents) *
            100,
        );
  return (
    <Card>
      <CardHeader title="The business right now" />
      <CardBody className="space-y-5">
        <StatGrid columns={2}>
          <Stat
            label="Money in, last 7 days"
            value={moneyRound(data.week.takingsCents)}
            hint={
              change === null
                ? "GST included"
                : `${change >= 0 ? "Up" : "Down"} ${String(Math.abs(change))}% on the week before (${moneyRound(data.previousWeek.takingsCents)})`
            }
          />
          <Stat
            label="Orders, last 7 days"
            value={String(data.week.orders)}
            hint={`${plural(data.week.units, "bottle")} in total`}
          />
          <Stat
            label="Average order"
            value={money(data.week.averageOrderCents)}
            hint="What a customer spends in one go"
          />
          <Stat
            label="GST inside those takings"
            value={moneyRound(data.week.gstCents)}
            hint="Collected for IRD, not income"
          />
        </StatGrid>
        <TakingsStrip days={data.days} />
      </CardBody>
    </Card>
  );
}

function ComingUp({ data }: { data: TodayData }) {
  return (
    <Card>
      <CardHeader title="Coming up" />
      {data.upcoming.length === 0 ? (
        <EmptyState
          headline="Nothing is scheduled"
          fills="Supplier deliveries, scheduled posts and planned batches appear here with their dates."
        >
          This is the next fortnight of things that happen without you doing
          anything.
        </EmptyState>
      ) : (
        <Rows>
          {data.upcoming.map((item) => (
            <Row key={item.id} href={item.href}>
              <p className="text-body-sm text-primary">{item.what}</p>
              <p
                className={`mt-0.5 text-caption ${item.late ? "text-danger" : "text-muted"}`}
              >
                {day(item.when)} ·{" "}
                {item.late ? `promised ${ago(item.when)}` : until(item.when)} ·{" "}
                {item.where}
              </p>
            </Row>
          ))}
        </Rows>
      )}
    </Card>
  );
}

function WhileAway({ data }: { data: TodayData }) {
  return (
    <Card>
      <CardHeader
        title="While you were away"
        action={{ label: "Full activity log", href: "/admin/activity" }}
      />
      {data.activity.length === 0 ? (
        <EmptyState
          headline="Nothing to show yet"
          fills="Grok Bot work appears here when it uses this admin."
        >
          Packing an order, correcting a count, or approving a post will leave a
          line in the activity log.
        </EmptyState>
      ) : (
        <>
          <Rows>
            {data.activity.slice(0, 5).map((entry) => (
              <Row key={entry.id} href={entry.href ?? undefined}>
                <p className="text-caption text-primary">{entry.summary}</p>
                <p className="mt-0.5 text-caption text-muted">
                  {entry.actor} · {dayAndTime(entry.occurredAt)}
                  {entry.entityLabel === null
                    ? ""
                    : ` · ${entry.entityLabel}`}
                </p>
              </Row>
            ))}
          </Rows>
          <CardBody className="border-t border-hairline">
            <ActionLink href="/admin/activity">See the activity log</ActionLink>
          </CardBody>
        </>
      )}
    </Card>
  );
}
