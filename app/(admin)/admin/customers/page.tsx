import type { Metadata } from "next";

import type { Customer } from "@/lib/commerce";

import {
  allCustomers,
  rollUpCustomers,
  searchCustomers,
} from "@/components/admin/data/commerce-reads";
import { load } from "@/components/admin/data/db";
import {
  ago,
  count,
  day,
  humanise,
  money,
  moneyRound,
  percent,
  plural,
} from "@/components/admin/data/format";
import {
  campaigns,
  emailSummary,
  recentReviews,
  reviewsNeedingAttention,
  subscriptionSummary,
} from "@/components/admin/data/queries";
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
  CardBody,
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
  title: "Customers & Marketing",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Customers & Marketing.
 *
 * A trade account and a person who bought one bottle are different businesses,
 * so they are labelled rather than mixed. "Came back" is used instead of
 * "retention", and a review that has waited more than a working day is called
 * a promise she made rather than a metric.
 */

const TYPE_WORDS: Readonly<Record<string, string>> = {
  retail: "Retail",
  trade: "Bar or restaurant",
  wholesale: "Wholesale",
  staff: "Staff",
  press: "Press",
};

function name(customer: Customer): string {
  return customer.displayName ?? customer.companyName ?? customer.email;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params["q"];
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";

  const result = await load(async () => {
    const [people, owed, reviews, marketing, email, subs, found] =
      await Promise.all([
        allCustomers(),
        reviewsNeedingAttention(),
        recentReviews(6),
        campaigns(6),
        emailSummary(),
        subscriptionSummary(),
        query === "" ? Promise.resolve([]) : searchCustomers(query, 25),
      ]);
    return { people, owed, reviews, marketing, email, subs, found };
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="Customers & Marketing"
          lede="Who buys, who comes back, and everything sent to them."
        />
        <DataUnavailable problem={result.problem} detail={result.detail} />
      </>
    );
  }

  const { people, owed, reviews, marketing, email, subs, found } = result.data;
  const rollup = rollUpCustomers(people);
  const top = [...people]
    .filter((customer) => customer.ordersCount > 0)
    .sort(
      (a, b) =>
        b.totalSpent.amountInMinorUnits - a.totalSpent.amountInMinorUnits,
    )
    .slice(0, 10);
  const shown = query === "" ? top : found;

  return (
    <>
      <PageHeader
        title="Customers & Marketing"
        lede="Who buys, who comes back, the bars and shops on the trade list, and everything sent to them."
        actions={
          <SearchForm
            action="/admin/customers"
            value={query}
            placeholder="Name or email"
            label="Search customers"
          />
        }
      />

      <PageSections>
        <Section title="Who buys">
          <div className="rounded-lg border border-hairline bg-surface-raised px-4 py-4">
            <StatGrid>
              <Stat
                label="People who have bought"
                value={count(rollup.total)}
                hint={`${count(people.length)} on the list in total`}
              />
              <Stat
                label="Came back for more"
                value={
                  rollup.total === 0
                    ? "—"
                    : percent(rollup.repeat / rollup.total)
                }
                hint={`${plural(rollup.repeat, "customer")} have ordered more than once`}
              />
              <Stat
                label="Bars, restaurants and shops"
                value={count(rollup.trade)}
                hint="Trade accounts, who buy by the case"
              />
              <Stat
                label="Happy to be emailed"
                value={count(rollup.marketing)}
                hint="Opted in, so they can be sent a campaign"
              />
            </StatGrid>
          </div>
        </Section>

        <Section
          title={query === "" ? "Best customers" : "Search results"}
          description={
            query === ""
              ? "By what they have spent since the shop opened."
              : "Matched on name and email address."
          }
        >
          <Card>
            {shown.length === 0 ? (
              <EmptyState headline={`Nothing matches “${query}”`}>
                Customer search looks at names, company names and email
                addresses. Order numbers live in Orders & Delivery.
              </EmptyState>
            ) : (
              <TableScroll>
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th>Kind</Th>
                    <Th numeric>Orders</Th>
                    <Th numeric>Spent</Th>
                    <Th>Last order</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((customer) => (
                    <tr key={customer.id}>
                      <Td>
                        {name(customer)}
                        <span className="block text-caption text-muted">
                          {customer.email}
                        </span>
                      </Td>
                      <Td>
                        {TYPE_WORDS[customer.customerType] ??
                          customer.customerType}
                      </Td>
                      <Td numeric>{customer.ordersCount}</Td>
                      <Td numeric>
                        {money(customer.totalSpent.amountInMinorUnits)}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {customer.lastOrderedAt === null
                          ? "—"
                          : day(customer.lastOrderedAt)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableScroll>
            )}
            {query !== "" && (
              <div className="border-t border-hairline px-4 py-3">
                <FilterNotice
                  query={query}
                  found={shown.length}
                  clearHref="/admin/customers"
                  noun="customer"
                />
              </div>
            )}
          </Card>
        </Section>

        <Section
          title="Reviews"
          description="A brand rule says a review gets an answer within one working day. These are the ones still owed one."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Owed a reply" count={owed.length} />
              {owed.length === 0 ? (
                <EmptyState
                  headline="Every review has been answered"
                  fills="A new review appears here as soon as a customer leaves one, whether it needs publishing or a reply."
                >
                  This is where reviews wait when they need something from you.
                </EmptyState>
              ) : (
                <Rows>
                  {owed.map((review) => (
                    <Row key={review.id}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p className="text-body-sm font-medium text-primary">
                          {review.title ?? `${String(review.rating)} stars`}
                        </p>
                        <Badge tone={review.rating <= 3 ? "danger" : "quiet"}>
                          {review.rating} out of 5
                        </Badge>
                      </div>
                      <p className="mt-1 text-caption text-muted">
                        {review.body}
                      </p>
                      <p className="mt-1 text-caption text-muted">
                        {review.author}
                        {review.verified ? ", a verified buyer" : ""}
                        {review.productTitle === null
                          ? ""
                          : ` · ${review.productTitle}`}{" "}
                        · {ago(review.createdAt)}
                      </p>
                    </Row>
                  ))}
                </Rows>
              )}
            </Card>

            <Card>
              <CardHeader title="Recently published" count={reviews.length} />
              <Rows>
                {reviews.map((review) => (
                  <Row key={review.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-body-sm text-primary">
                        {review.title ?? review.author}
                      </p>
                      <span className="text-caption text-muted">
                        {review.rating} out of 5
                      </span>
                    </div>
                    <p className="mt-0.5 text-caption text-muted">
                      {review.author} · {review.productTitle ?? "the range"} ·{" "}
                      {review.repliedAt === null
                        ? "no reply sent"
                        : `replied ${ago(review.repliedAt)}`}
                    </p>
                  </Row>
                ))}
              </Rows>
            </Card>
          </div>
        </Section>

        <Section
          title="Campaigns and email"
          description="What has been sent, and what it brought back."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Campaigns" count={marketing.length} />
              {marketing.length === 0 ? (
                <EmptyState
                  headline="No campaigns yet"
                  fills="A campaign appears here once one is planned, with what it cost and what it brought in."
                >
                  A campaign is any push with a start, an end and a budget: an
                  email, a market stall, a paid post.
                </EmptyState>
              ) : (
                <Rows>
                  {marketing.map((campaign) => (
                    <Row key={campaign.id}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p className="text-body-sm text-primary">
                          {campaign.name}
                        </p>
                        <Badge tone="quiet">{humanise(campaign.status)}</Badge>
                      </div>
                      <p className="mt-0.5 text-caption text-muted">
                        {humanise(campaign.channel)}
                        {campaign.startsAt === null
                          ? ""
                          : ` · from ${day(campaign.startsAt)}`}
                      </p>
                      <p className="mt-0.5 text-caption text-muted">
                        {moneyRound(campaign.spendCents)} spent ·{" "}
                        {moneyRound(campaign.revenueCents)} brought in
                      </p>
                    </Row>
                  ))}
                </Rows>
              )}
            </Card>

            <Card>
              <CardHeader title="Email and subscriptions" />
              <CardBody>
                <StatGrid columns={2}>
                  <Stat
                    label="Emails sent"
                    value={count(email.sent)}
                    hint={`${count(email.delivered)} arrived, ${count(email.bounced)} bounced`}
                  />
                  <Stat
                    label="Opened"
                    value={
                      email.delivered === 0
                        ? "—"
                        : percent(email.opened / email.delivered)
                    }
                    hint={`${count(email.clicked)} clicked through to the shop`}
                  />
                  <Stat
                    label="Repeat deliveries"
                    value={count(subs.active)}
                    hint={
                      subs.nextBillingAt === null
                        ? "Nobody on a subscription yet"
                        : `Next one bills ${day(subs.nextBillingAt)}`
                    }
                  />
                  <Stat
                    label="Waiting to send"
                    value={count(email.queued)}
                    hint="Drafted or queued, not yet sent"
                  />
                </StatGrid>
              </CardBody>
            </Card>
          </div>
        </Section>

        <NotBuiltYet
          works={[
            "Every customer through the commerce adapter, with what they have spent",
            "Trade accounts separated from retail buyers",
            "Reviews still owed a reply, and what has been published",
            "Campaign spend against what each one brought in",
          ]}
          coming={[
            "One page per customer, with their whole order history",
            "Writing and sending a campaign from here",
            "Replying to a review without leaving the admin",
            "Segments — lapsed buyers, bars that have not reordered, the boxed-set crowd",
          ]}
        />
      </PageSections>
    </>
  );
}
