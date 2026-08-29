import type { Metadata } from "next";

import {
  allProducts,
  between,
  inventoryLevels,
  locations,
  nameStockLines,
  ordersSince,
  stockBySku,
  unitsBySku,
} from "@/components/admin/data/commerce-reads";
import { load } from "@/components/admin/data/db";
import {
  ago,
  count,
  day,
  dayAndYear,
  money,
  plural,
  quantity,
  until,
} from "@/components/admin/data/format";
import {
  allIngredients,
  batchesInProgress,
  purchaseOrders,
  recentBatches,
  suppliers,
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
  CardHeader,
  EmptyState,
  Meter,
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
  title: "Stock & Batches",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Stock & Batches — what exists, what is being made, and what is running out.
 *
 * The number that matters here is not "how many bottles" but "how many days",
 * so every stock line carries days of cover worked out from the last month of
 * real sales. A count with no rate attached is a number she has to do
 * arithmetic on before it means anything.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const BATCH_WORDS: Readonly<Record<string, string>> = {
  planned: "Planned",
  brewing: "Brewing",
  fermenting: "Fermenting",
  conditioning: "Conditioning",
  bottling: "Bottling",
  qa_hold: "Held for testing",
  released: "Released for sale",
  sold_out: "Sold out",
  recalled: "Recalled",
  discarded: "Discarded",
};

const PO_WORDS: Readonly<Record<string, string>> = {
  draft: "Draft",
  pending_approval: "Waiting on you",
  ordered: "Ordered",
  partially_received: "Part arrived",
  received: "Arrived",
  cancelled: "Cancelled",
};

function matches(
  query: string,
  ...fields: readonly (string | null)[]
): boolean {
  if (query === "") return true;
  const term = query.toLowerCase();
  return fields.some(
    (field) => field !== null && field.toLowerCase().includes(term),
  );
}

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params["q"];
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";

  const result = await load(async () => {
    const now = new Date();
    const [
      levels,
      products,
      places,
      orders,
      ingredients,
      making,
      made,
      po,
      vendors,
    ] = await Promise.all([
      inventoryLevels(),
      allProducts(),
      locations(),
      ordersSince(new Date(now.getTime() - 30 * DAY_MS)),
      allIngredients(),
      batchesInProgress(),
      recentBatches(10),
      purchaseOrders(8),
      suppliers(),
    ]);
    const sold = unitsBySku(
      between(orders, new Date(now.getTime() - 30 * DAY_MS), now),
    );
    const perDay = new Map<string, number>();
    for (const [sku, units] of sold) perDay.set(sku, units / 30);
    return {
      stock: stockBySku(nameStockLines(levels, products, places), perDay),
      ingredients,
      making,
      made,
      po,
      vendors,
    };
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="Stock & Batches"
          lede="Bottles on hand, ingredients running low, and every batch from the fermenter to the shelf."
        />
        <DataUnavailable problem={result.problem} detail={result.detail} />
      </>
    );
  }

  const { stock, ingredients, making, made, po, vendors } = result.data;
  const bottles = stock.reduce((sum, line) => sum + line.available, 0);
  const tightest = stock[0];
  const low = ingredients.filter(
    (item) => item.reorderPoint > 0 && item.stockOnHand <= item.reorderPoint,
  );
  const shownIngredients = ingredients.filter((item) =>
    matches(query, item.name, item.code, item.category, item.supplierName),
  );
  const shownBatches = made.filter((batch) =>
    matches(query, batch.code, batch.productTitle, batch.status),
  );
  const shownVendors = vendors.filter((vendor) =>
    matches(query, vendor.name, vendor.code, vendor.city, vendor.region),
  );

  return (
    <>
      <PageHeader
        title="Stock & Batches"
        lede="Bottles ready to sell, ingredients running low, and every batch from the fermenter to the shelf."
        actions={
          <SearchForm
            action="/admin/stock"
            value={query}
            placeholder="Ingredient, batch code, supplier"
            label="Search stock"
          />
        }
      />

      <PageSections>
        <Section title="Where things stand">
          <div className="rounded-lg border border-hairline bg-surface-raised px-4 py-4">
            <StatGrid>
              <Stat
                label="Bottles ready to sell"
                value={count(bottles)}
                hint="Across the kitchen and the coolstore"
              />
              <Stat
                label="Tightest line"
                value={
                  tightest === undefined || tightest.coverDays === null
                    ? "—"
                    : `${String(tightest.coverDays)} days`
                }
                hint={
                  tightest === undefined
                    ? "Nothing is being tracked yet"
                    : `${tightest.productTitle} at the last month's rate`
                }
              />
              <Stat
                label="Ingredients running low"
                value={String(low.length)}
                hint={
                  low.length === 0
                    ? "Everything is above its reorder point"
                    : low.map((item) => item.name).join(", ")
                }
                tone={low.length > 0 ? "danger" : "neutral"}
              />
              <Stat
                label="Batches being made"
                value={String(making.length)}
                hint="In a fermenter or on the bottling line"
              />
            </StatGrid>
          </div>
        </Section>

        <Section
          title="Bottles"
          description="Days of cover are worked out from the last thirty days of real sales. A batch takes about a week from the fermenter to the shelf."
        >
          <Card>
            <Rows>
              {stock.map((line) => (
                <Row key={line.sku}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-body-sm font-medium text-primary">
                      {line.productTitle}
                    </p>
                    <p className="text-caption text-muted tabular-nums">
                      {count(line.available)} ready ·{" "}
                      {line.coverDays === null
                        ? "not selling yet"
                        : `about ${String(line.coverDays)} days left`}
                    </p>
                  </div>
                  <div className="mt-2">
                    {/* Days of cover, capped at ninety. Bottles on their own do
                        not say whether that is a lot. A line with no recent
                        sales gets a sentence instead of a bar. */}
                    {line.coverDays === null ? (
                      <p className="text-caption text-muted">
                        Nothing sold in the last month, so there is no rate to
                        judge this by yet.
                      </p>
                    ) : (
                      <Meter
                        value={Math.min(line.coverDays, 90)}
                        max={90}
                        tone={line.coverDays < 21 ? "danger" : "neutral"}
                        label={`${line.productTitle}: about ${String(line.coverDays)} days of stock left, ${count(line.available)} ready to sell`}
                      />
                    )}
                  </div>
                  <p className="mt-2 text-caption text-muted">
                    {line.locations
                      .map(
                        (place) =>
                          `${place.locationName}: ${count(place.available)}`,
                      )
                      .join(" · ")}
                    {line.committed > 0
                      ? ` · ${count(line.committed)} held for orders already placed`
                      : ""}
                    {line.soldPerDay > 0
                      ? ` · selling about ${quantity(Math.round(line.soldPerDay * 7))} a week`
                      : ""}
                  </p>
                </Row>
              ))}
            </Rows>
          </Card>
        </Section>

        <Section
          title="Being made now"
          description="Batches in the fermenter, conditioning, or on the bottling line."
        >
          <Card>
            {making.length === 0 ? (
              <EmptyState
                headline="Nothing is in production"
                fills="A batch appears here the day it is started, and moves through brewing, fermenting, bottling and testing before it is released."
              >
                This is the production line: everything that has been started
                and is not yet on the shelf.
              </EmptyState>
            ) : (
              <Rows>
                {making.map((batch) => (
                  <Row key={batch.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-body-sm font-medium text-primary">
                        {batch.productTitle ?? batch.code}
                      </p>
                      <Badge tone="quiet">
                        {BATCH_WORDS[batch.status] ?? batch.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-caption text-muted">
                      Batch {batch.code}
                      {batch.recipeName === null
                        ? ""
                        : ` · ${batch.recipeName}`}
                      {batch.locationName === null
                        ? ""
                        : ` · ${batch.locationName}`}
                      {batch.plannedFor === null
                        ? ""
                        : ` · started ${day(batch.plannedFor)}`}
                    </p>
                    {batch.notes !== null && (
                      <p className="mt-1 text-caption text-muted">
                        {batch.notes}
                      </p>
                    )}
                  </Row>
                ))}
              </Rows>
            )}
          </Card>
        </Section>

        <Section
          title="Ingredients and packaging"
          description="What is in the store room, and the point at which you reorder it. Low ones first."
        >
          <Card>
            <CardHeader
              title="Store room"
              count={shownIngredients.length}
              note={`${plural(low.length, "line")} at or under the reorder point`}
            />
            {shownIngredients.length === 0 ? (
              <EmptyState headline={`Nothing matches “${query}”`}>
                Try an ingredient name like dill, a code like BOTTLE_500, or a
                supplier.
              </EmptyState>
            ) : (
              <TableScroll>
                <thead>
                  <tr>
                    <Th>Ingredient</Th>
                    <Th numeric>In store</Th>
                    <Th numeric>Reorder at</Th>
                    <Th>Supplier</Th>
                    <Th numeric>Days to arrive</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...shownIngredients]
                    .sort((a, b) => {
                      const aLow =
                        a.reorderPoint > 0 && a.stockOnHand <= a.reorderPoint;
                      const bLow =
                        b.reorderPoint > 0 && b.stockOnHand <= b.reorderPoint;
                      if (aLow !== bLow) return aLow ? -1 : 1;
                      return a.name.localeCompare(b.name);
                    })
                    .map((item) => {
                      const isLow =
                        item.reorderPoint > 0 &&
                        item.stockOnHand <= item.reorderPoint;
                      return (
                        <tr key={item.id}>
                          <Td>
                            <span className="flex flex-wrap items-center gap-2">
                              {item.name}
                              {isLow && <Badge tone="danger">Low</Badge>}
                            </span>
                          </Td>
                          <Td numeric>
                            {quantity(item.stockOnHand, item.unit)}
                          </Td>
                          <Td numeric>
                            {item.reorderPoint === 0
                              ? "—"
                              : quantity(item.reorderPoint, item.unit)}
                          </Td>
                          <Td>{item.supplierName ?? "None chosen"}</Td>
                          <Td numeric>{item.supplierLeadDays ?? "—"}</Td>
                        </tr>
                      );
                    })}
                </tbody>
              </TableScroll>
            )}
            {query !== "" && (
              <div className="border-t border-hairline px-4 py-3">
                <FilterNotice
                  query={query}
                  found={shownIngredients.length}
                  clearHref="/admin/stock"
                  noun="ingredient"
                />
              </div>
            )}
          </Card>
        </Section>

        <Section
          title="Batches made"
          description="Every batch that has been through the line, with what it cost to make a bottle."
        >
          <Card>
            <TableScroll>
              <thead>
                <tr>
                  <Th>Batch</Th>
                  <Th>Product</Th>
                  <Th>State</Th>
                  <Th numeric>Made</Th>
                  <Th numeric>Left</Th>
                  <Th numeric>Cost a bottle</Th>
                  <Th>Best before</Th>
                </tr>
              </thead>
              <tbody>
                {shownBatches.map((batch) => (
                  <tr key={batch.id}>
                    <Td className="whitespace-nowrap">{batch.code}</Td>
                    <Td>{batch.productTitle ?? "—"}</Td>
                    <Td>{BATCH_WORDS[batch.status] ?? batch.status}</Td>
                    <Td numeric>{count(batch.unitsProduced)}</Td>
                    <Td numeric>{count(batch.unitsRemaining)}</Td>
                    <Td numeric>
                      {batch.unitCostCents === 0
                        ? "—"
                        : money(batch.unitCostCents)}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {batch.expiresAt === null
                        ? "—"
                        : dayAndYear(batch.expiresAt)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
          </Card>
        </Section>

        <Section
          title="Suppliers and orders placed with them"
          description="Who supplies what, how long they take, and what is on its way."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Suppliers" count={shownVendors.length} />
              <Rows>
                {shownVendors.map((vendor) => (
                  <Row key={vendor.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-body-sm text-primary">{vendor.name}</p>
                      <p className="text-caption text-muted">
                        {vendor.leadTimeDays === null
                          ? "Lead time unknown"
                          : `${plural(vendor.leadTimeDays, "day")} to arrive`}
                      </p>
                    </div>
                    <p className="mt-0.5 text-caption text-muted">
                      {[vendor.city, vendor.region]
                        .filter((part) => part !== null)
                        .join(", ")}
                      {vendor.contactName === null
                        ? ""
                        : ` · ${vendor.contactName}`}
                    </p>
                  </Row>
                ))}
              </Rows>
            </Card>

            <Card>
              <CardHeader
                title="Orders placed with suppliers"
                count={po.length}
              />
              <Rows>
                {po.map((order) => (
                  <Row key={order.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-body-sm text-primary">
                        {order.supplierName}
                      </p>
                      <Badge
                        tone={
                          order.status === "pending_approval"
                            ? "accent"
                            : "neutral"
                        }
                      >
                        {PO_WORDS[order.status] ?? order.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-caption text-muted">
                      {order.number} · {money(order.totalCents)}
                      {order.lines.length > 0
                        ? ` · ${order.lines.join(", ")}`
                        : ""}
                    </p>
                    <p className="mt-0.5 text-caption text-muted">
                      {order.receivedAt !== null
                        ? `Arrived ${ago(order.receivedAt)}`
                        : order.expectedAt !== null
                          ? `Due ${day(order.expectedAt)}, ${until(order.expectedAt)}`
                          : "No date yet"}
                    </p>
                  </Row>
                ))}
              </Rows>
            </Card>
          </div>
        </Section>

        <NotBuiltYet
          works={[
            "Live stock at both locations, read through the commerce adapter",
            "Days of cover worked out from the last month of real sales",
            "Ingredients against their reorder points, with the supplier and lead time",
            "Every batch, its cost a bottle, and what is left of it",
          ]}
          coming={[
            "Starting a batch, and moving it through the line",
            "Recording a stocktake or a breakage",
            "Sending a purchase order to a supplier from here",
            "The recipe each batch was made from, with its version history",
          ]}
        />
      </PageSections>
    </>
  );
}
