import type { Metadata } from "next";

import { requireAdminSession } from "@/lib/auth/server";

import { commerce, load } from "@/components/admin/data/db";
import {
  ago,
  dayAndTime,
  deviceName,
  humanise,
  money,
  settingLabel,
} from "@/components/admin/data/format";
import {
  agentSpend,
  companyFacts,
  operator,
  operatorSessions,
  settings,
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
  Callout,
  Card,
  CardBody,
  CardHeader,
  DefinitionList,
  Dot,
  Row,
  Rows,
  TableScroll,
  Td,
  Th,
} from "@/components/admin/ui/primitives";
import { FilterNotice, SearchForm } from "@/components/admin/ui/search-form";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Settings — the facts the rest of the company is built on.
 *
 * Read-only, and it says so. The values here are the ones that appear on
 * invoices, labels and the storefront, so showing them is useful long before
 * editing them is; a settings screen whose fields look editable but silently
 * discard a change is worse than one that is honest about being a mirror.
 */

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params["q"];
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const { session } = await requireAdminSession();

  const result = await load(async () => {
    const [facts, rows, sessions, person, spend] = await Promise.all([
      companyFacts(),
      settings(),
      operatorSessions(session.operatorId, session.id),
      operator(session.operatorId),
      agentSpend(),
    ]);
    return {
      facts,
      rows,
      sessions,
      person,
      spend,
      providerName: commerce().name,
    };
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="Settings"
          lede="Company details, tax and shipping rules, the shop connection, and who is signed in."
        />
        <DataUnavailable problem={result.problem} detail={result.detail} />
      </>
    );
  }

  const { facts, rows, sessions, person, spend, providerName } = result.data;
  const shown = rows.filter(
    (row) =>
      query === "" ||
      row.key.toLowerCase().includes(query.toLowerCase()) ||
      (row.description ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Settings"
        lede="The facts everything else is built on: who the company is, how it charges tax and shipping, what it is connected to, and who can get in."
        actions={
          <SearchForm
            action="/admin/settings"
            value={query}
            placeholder="Setting name"
            label="Search settings"
          />
        }
      />

      <PageSections>
        <Section
          title="The company"
          description="These appear on invoices, on the storefront and on every label."
        >
          <Card>
            <CardBody>
              <DefinitionList
                items={[
                  { term: "Trading as", value: facts.tradingName },
                  { term: "Registered name", value: facts.legalName },
                  {
                    term: "NZBN",
                    value: facts.nzbn,
                    hint: "New Zealand Business Number",
                  },
                  {
                    term: "GST number",
                    value: facts.gstNumber,
                    hint: "Shown on every tax invoice",
                  },
                  { term: "Address", value: facts.address },
                  { term: "Customer email", value: facts.supportEmail },
                ]}
              />
            </CardBody>
          </Card>
        </Section>

        <Section
          title="Tax and delivery"
          description="What a customer is charged, and when postage becomes free."
        >
          <Card>
            <CardBody>
              <DefinitionList
                items={[
                  {
                    term: "GST",
                    value: `${(facts.gstRateBasisPoints / 100).toFixed(0)}%`,
                    hint: "Included in every price shown to a customer, as New Zealand law requires",
                  },
                  {
                    term: "Standard postage",
                    value: money(facts.standardShippingCents),
                  },
                  {
                    term: "Free postage over",
                    value: money(facts.freeShippingThresholdCents),
                  },
                  { term: "Currency", value: "New Zealand dollars" },
                  { term: "Time zone", value: "Pacific/Auckland" },
                ]}
              />
            </CardBody>
          </Card>
        </Section>

        <Section
          title="The shop connection"
          description="Where orders, products and stock are read from."
        >
          <Card>
            <CardBody className="space-y-4">
              <DefinitionList
                items={[
                  {
                    term: "Reading from",
                    value:
                      providerName === "shopify"
                        ? "Shopify, live"
                        : "The local mirror of the shop",
                    hint:
                      providerName === "shopify"
                        ? "Orders and stock come straight from Shopify."
                        : "Every screen reads through the same adapter, so nothing changes here on the day the Shopify keys are added.",
                  },
                  { term: "Shop", value: facts.shopDomain },
                ]}
              />
              {providerName !== "shopify" && (
                <Callout title="Not connected to Shopify yet">
                  The API tokens have not been created — only the founder can
                  make them, in Shopify under Apps and sales channels. Until
                  then this admin reads the mirror, which is a real copy of the
                  shop&rsquo;s data.
                </Callout>
              )}
            </CardBody>
          </Card>
        </Section>

        <Section
          title="Who can get in"
          description="One password, one person. Every sign-in is recorded and can be revoked."
        >
          <Card>
            <CardBody className="space-y-4">
              <DefinitionList
                items={[
                  {
                    term: "Signed in as",
                    value: person?.name ?? "Unknown",
                    hint: person?.email,
                  },
                  {
                    term: "Last seen",
                    value:
                      person?.lastSeenAt === null ||
                      person?.lastSeenAt === undefined
                        ? "—"
                        : ago(person.lastSeenAt),
                  },
                  {
                    term: "This session ends",
                    value: dayAndTime(session.expiresAt.toISOString()),
                    hint: "Sooner if it sits idle for half an hour",
                  },
                ]}
              />
              <Callout
                title="The password is a demonstration password"
                tone="danger"
              >
                It is fine for showing the admin to people, and it is not fine
                for a live shop. It is the only thing between the internet and
                the whole business, and it should be replaced before the
                storefront opens.
              </Callout>
            </CardBody>
            <CardHeader title="Recent sign-ins" count={sessions.length} />
            <Rows>
              {sessions.map((item) => (
                <Row key={item.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="flex items-center gap-2 text-body-sm text-primary">
                      <Dot
                        tone={
                          item.revokedAt !== null || item.isExpired
                            ? "quiet"
                            : item.isCurrent
                              ? "live"
                              : "warn"
                        }
                      />
                      {item.device ?? deviceName(item.userAgent)}
                    </p>
                    {item.isCurrent && <Badge tone="quiet">This device</Badge>}
                    {item.revokedAt !== null ? (
                      <Badge tone="neutral">Signed out</Badge>
                    ) : item.isExpired ? (
                      <Badge tone="neutral">Expired</Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-caption text-muted">
                    Started {ago(item.startedAt)} · last used{" "}
                    {ago(item.lastActiveAt)}
                    {item.ipAddress === null ? "" : ` · from ${item.ipAddress}`}
                  </p>
                </Row>
              ))}
            </Rows>
          </Card>
        </Section>

        <Section
          title="How the AI team is governed"
          description="The rules that apply to all six of them at once."
        >
          <Card>
            <CardBody>
              <DefinitionList
                items={[
                  {
                    term: "Emergency stop",
                    value: spend.killSwitchOn
                      ? "On — every agent is stopped"
                      : "Off — the team is working",
                    hint: "One switch halts every agent mid-job",
                  },
                  {
                    term: "Spent today",
                    value: `${money(spend.todayCents)} of ${money(spend.dailyCapCents)}`,
                    hint: "Each agent stops itself at its own limit",
                  },
                  {
                    term: "Spent this month",
                    value: money(spend.monthCents),
                  },
                ]}
              />
            </CardBody>
          </Card>
        </Section>

        <Section
          title="Every setting"
          description="The full list, as the rest of the company reads it. Secrets are held in a vault and are never shown here. Where one of these disagrees with the shop connection above, the section above is what is actually running."
        >
          <Card>
            <CardHeader title="All settings" count={shown.length} />
            <TableScroll>
              <thead>
                <tr>
                  <Th>Setting</Th>
                  <Th>Value</Th>
                  <Th>What it is for</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.key}>
                    <Td>
                      {settingLabel(row.key)}
                      <span className="block text-caption text-muted">
                        {humanise(row.category)}
                      </span>
                    </Td>
                    <Td>
                      {row.isSecret ? (
                        <Badge tone="neutral">Held in the vault</Badge>
                      ) : (
                        row.value
                      )}
                    </Td>
                    <Td className="text-muted">{row.description ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
            {query !== "" && (
              <div className="border-t border-hairline px-4 py-3">
                <FilterNotice
                  query={query}
                  found={shown.length}
                  clearHref="/admin/settings"
                  noun="setting"
                />
              </div>
            )}
          </Card>
        </Section>

        <NotBuiltYet
          works={[
            "Every setting the company runs on, read from the database",
            "Which shop the admin is reading from, and whether it is live",
            "Every sign-in on this account, with the current one marked",
            "The team's spending limits and the state of the emergency stop",
          ]}
          coming={[
            "Changing any of these — today they are edited in the database",
            "Signing out another device from here",
            "Changing the admin password without a script",
            "Turning the emergency stop on and off",
          ]}
        />
      </PageSections>
    </>
  );
}
