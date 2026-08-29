/**
 * The roster's reads, in SQL.
 *
 * One class, one query per method, no ORM and no cleverness. It takes any
 * `$1`-style client so the same code runs under `pg` in the admin and under
 * PGlite in the tests — which is what lets the evidence runs read the real
 * seeded business instead of a fixture.
 *
 * Three rules hold in every method:
 *
 *  1. **The analysis is here, not in the prompt.** Days of cover, margin against
 *     the floor, reorder cadence and week-on-week change are computed from rows.
 *     A model is handed the finished number and told not to invent another one.
 *  2. **Money stays integer cents.** `numeric` and `bigint` arrive as strings
 *     from `pg`; they are narrowed at this boundary and never float.
 *  3. **A missing fact is `null` and says so.** No default, no estimate, no
 *     "approximately". An agent that cannot see something must report that it
 *     cannot see it.
 */

import type {
  AccountMemory,
  BatchLine,
  BatchPlanReport,
  BusinessReads,
  CatalogueLine,
  ContentReport,
  ConversationReport,
  CustomerHistory,
  IngredientLine,
  MarginLine,
  MarginReport,
  OpenConversation,
  PostLine,
  RangeReport,
  ReviewThemeLine,
  SalesReport,
  SkuSalesLine,
  StockCoverLine,
  StockCoverReport,
  TakingsReport,
  TradeAccountLine,
  TradeReport,
  WeeklyPulse,
} from "./reads";

export type RosterSqlRow = Record<string, unknown>;

/** The narrowest client these queries need. `pg` and PGlite both satisfy it. */
export interface RosterSqlClient {
  query<R extends RosterSqlRow = RosterSqlRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: R[] }>;
}

/** The margin the company holds itself to. Quoted in Teller's prompt. */
export const MARGIN_FLOOR_PCT = 60;

/** Days of cover under which ops should be planning a batch, not watching one. */
export const COVER_WARNING_DAYS = 21;

/** How long a paid order may sit unfulfilled before the concierge picks it up. */
export const FULFILMENT_GRACE_DAYS = 2;

/* ------------------------------------------------------------- narrowing */

function str(row: RosterSqlRow, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

function strOrNull(row: RosterSqlRow, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function num(row: RosterSqlRow, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function int(row: RosterSqlRow, key: string): number {
  return Math.trunc(num(row, key));
}

function intOrNull(row: RosterSqlRow, key: string): number | null {
  return row[key] === null || row[key] === undefined ? null : int(row, key);
}

function boolOrNull(row: RosterSqlRow, key: string): boolean | null {
  const value = row[key];
  return typeof value === "boolean" ? value : null;
}

function iso(row: RosterSqlRow, key: string): string | null {
  const value = row[key];
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value !== "") return value;
  return null;
}

/* ------------------------------------------------------------ formatting */

/** Integer cents to the shape a New Zealander reads. Display only. */
export function nzd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}NZ$${String(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
}

function pct(value: number, places = 1): string {
  return `${value.toFixed(places)}%`;
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Change between two numbers as a percentage, or null when there is no base. */
function changePct(now: number, before: number): number | null {
  if (before === 0) return null;
  return round(((now - before) / before) * 100);
}

/* ------------------------------------------------------------------ class */

export class SqlBusinessReads implements BusinessReads {
  constructor(private readonly sql: RosterSqlClient) {}

  private async rows(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<RosterSqlRow[]> {
    const result = await this.sql.query(text, params);
    return [...result.rows];
  }

  private async gstRateBp(): Promise<number> {
    const rows = await this.rows(
      `select value from public.settings where key = 'tax.gst_rate_bp'`,
    );
    const raw = rows[0]?.["value"];
    const parsed =
      typeof raw === "number"
        ? raw
        : typeof raw === "string"
          ? Number.parseInt(raw, 10)
          : Number.NaN;
    return Number.isFinite(parsed) ? parsed : 1500;
  }

  /* ------------------------------------------------------------ catalogue */

  async catalogue(): Promise<readonly CatalogueLine[]> {
    const rows = await this.rows(
      `select v.sku, p.handle, p.title, v.price_cents, v.unit_cost_cents,
              p.status, v.is_trade_only
         from public.product_variants v
         join public.products p on p.id = v.product_id
        where v.deleted_at is null and p.deleted_at is null
        order by v.sku`,
    );
    return rows.map((row) => ({
      sku: str(row, "sku"),
      handle: str(row, "handle"),
      title: str(row, "title"),
      priceCents: int(row, "price_cents"),
      unitCostCents: intOrNull(row, "unit_cost_cents"),
      status: str(row, "status"),
      tradeOnly: row["is_trade_only"] === true,
    }));
  }

  /* ----------------------------------------------------------- stock cover */

  private async coverLines(
    windowDays: number,
  ): Promise<readonly StockCoverLine[]> {
    const rows = await this.rows(
      `select v.sku, p.title,
              coalesce(sum(distinct_levels.available), 0)     as available,
              coalesce(sum(distinct_levels.on_hand), 0)       as on_hand,
              coalesce(max(distinct_levels.reorder_point), 0) as reorder_point,
              coalesce(sold.units, 0)                         as units
         from public.product_variants v
         join public.products p on p.id = v.product_id
         left join public.inventory_levels distinct_levels
           on distinct_levels.variant_id = v.id
         left join lateral (
           select sum(oi.quantity) as units
             from public.order_items oi
             join public.orders o on o.id = oi.order_id
            where oi.variant_id = v.id
              and o.status <> 'cancelled'
              and o.placed_at > now() - ($1::int * interval '1 day')
         ) sold on true
        where v.deleted_at is null
        group by v.sku, p.title, sold.units
        order by v.sku`,
      [windowDays],
    );
    return rows.map((row) => {
      const available = int(row, "available");
      const units = int(row, "units");
      const perDay = windowDays === 0 ? 0 : units / windowDays;
      return {
        sku: str(row, "sku"),
        title: str(row, "title"),
        available,
        onHand: int(row, "on_hand"),
        reorderPoint: int(row, "reorder_point"),
        unitsPerDay: round(perDay, 2),
        daysOfCover: perDay === 0 ? null : Math.round(available / perDay),
      };
    });
  }

  async stockCover(windowDays: number): Promise<StockCoverReport> {
    const lines = await this.coverLines(windowDays);
    const ingredientRows = await this.rows(
      `select i.code, i.name, i.unit, i.stock_on_hand, i.reorder_point,
              i.reorder_quantity, i.standard_cost_cents,
              s.name as supplier, s.code as supplier_code, s.lead_time_days
         from public.ingredients i
         left join public.suppliers s on s.id = i.preferred_supplier_id
        where i.is_active and i.reorder_point > 0
          and i.stock_on_hand <= i.reorder_point
        order by (i.stock_on_hand - i.reorder_point)`,
    );
    const ingredients: IngredientLine[] = ingredientRows.map((row) => ({
      code: str(row, "code"),
      name: str(row, "name"),
      unit: str(row, "unit"),
      onHand: round(num(row, "stock_on_hand"), 2),
      reorderPoint: round(num(row, "reorder_point"), 2),
      reorderQuantity: round(num(row, "reorder_quantity"), 2),
      standardCostCents: int(row, "standard_cost_cents"),
      supplier: strOrNull(row, "supplier"),
      supplierCode: strOrNull(row, "supplier_code"),
      leadTimeDays: intOrNull(row, "lead_time_days"),
    }));

    const short = lines.filter(
      (line) =>
        line.available <= line.reorderPoint ||
        (line.daysOfCover !== null && line.daysOfCover <= COVER_WARNING_DAYS),
    );
    const worst = ingredients[0] ?? null;
    const proposal =
      worst === null || worst.supplierCode === null
        ? null
        : {
            supplierCode: worst.supplierCode,
            supplierName: worst.supplier ?? worst.supplierCode,
            ingredientCode: worst.code,
            quantity: worst.reorderQuantity,
            unit: worst.unit,
            amountCents: Math.round(
              worst.reorderQuantity * worst.standardCostCents,
            ),
            reason: `${worst.name} is at ${String(worst.onHand)}${worst.unit} against a reorder point of ${String(worst.reorderPoint)}${worst.unit}, and ${worst.supplier ?? "the supplier"} takes ${worst.leadTimeDays === null ? "an unrecorded number of" : String(worst.leadTimeDays)} days.`,
          };

    const findings = [
      ...lines.map(
        (line) =>
          `${line.title}: ${String(line.available)} bottles available, selling ${String(line.unitsPerDay)} a day — ${line.daysOfCover === null ? "no sales in the window, so no cover figure" : `${String(line.daysOfCover)} days of cover`}.`,
      ),
      ...ingredients.map(
        (item) =>
          `${item.name} is below its reorder point: ${String(item.onHand)}${item.unit} on hand against ${String(item.reorderPoint)}${item.unit}, ${item.leadTimeDays === null ? "lead time not recorded" : `${String(item.leadTimeDays)} day lead time`}.`,
      ),
    ];

    const headline =
      ingredients.length === 0 && short.length === 0
        ? `Nothing needs ordering. Every bottle line has more than ${String(COVER_WARNING_DAYS)} days of cover and every ingredient is above its reorder point.`
        : ingredients.length > 0
          ? `${String(ingredients.length)} ingredient${ingredients.length === 1 ? " is" : "s are"} below the reorder point${short.length > 0 ? `, and ${String(short.length)} bottle line${short.length === 1 ? " is" : "s are"} inside ${String(COVER_WARNING_DAYS)} days of cover` : ""}.`
          : `${String(short.length)} bottle line${short.length === 1 ? " is" : "s are"} inside ${String(COVER_WARNING_DAYS)} days of cover.`;

    return {
      windowDays,
      lines,
      ingredientsBelowReorder: ingredients,
      headline,
      findings,
      proposal,
    };
  }

  /* ------------------------------------------------------------- batches */

  async batchPlan(windowDays: number): Promise<BatchPlanReport> {
    const rows = await this.rows(
      `select b.batch_code, v.sku, b.status,
              b.planned_for, b.expires_at, b.units_remaining,
              b.unit_cost_cents, b.qa_passed
         from public.batches b
         left join public.product_variants v on v.id = b.variant_id
        order by coalesce(b.produced_at, b.planned_for) desc nulls last`,
    );
    const all: BatchLine[] = rows.map((row) => ({
      batchCode: str(row, "batch_code"),
      sku: strOrNull(row, "sku"),
      status: str(row, "status"),
      plannedFor: iso(row, "planned_for"),
      expiresAt: iso(row, "expires_at"),
      unitsRemaining: int(row, "units_remaining"),
      unitCostCents: intOrNull(row, "unit_cost_cents"),
      qaPassed: boolOrNull(row, "qa_passed"),
    }));

    const inFlight = all.filter((batch) =>
      ["planned", "fermenting", "bottling", "conditioning", "testing"].includes(
        batch.status,
      ),
    );
    const released = all.filter((batch) => batch.status === "released");
    const horizon = Date.now() + 120 * 24 * 60 * 60 * 1000;
    const expiringSoon = released.filter(
      (batch) =>
        batch.unitsRemaining > 0 &&
        batch.expiresAt !== null &&
        Date.parse(batch.expiresAt) < horizon,
    );

    const cover = await this.coverLines(windowDays);
    const ranked = [...cover]
      .filter((line) => line.daysOfCover !== null)
      .sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0));
    const first = ranked[0];
    const nextToBrew =
      first === undefined
        ? null
        : { sku: first.sku, daysOfCover: first.daysOfCover };

    const findings = [
      ...inFlight.map(
        (batch) =>
          `${batch.batchCode} is ${batch.status}${batch.plannedFor === null ? "" : `, started ${batch.plannedFor.slice(0, 10)}`}.`,
      ),
      ...expiringSoon.map(
        (batch) =>
          `${batch.batchCode} has ${String(batch.unitsRemaining)} bottles left and reaches its best-before on ${(batch.expiresAt ?? "").slice(0, 10)}.`,
      ),
      nextToBrew === null
        ? "No line has enough sales history to rank what should be brewed next."
        : `${nextToBrew.sku} has the least cover at ${String(nextToBrew.daysOfCover ?? 0)} days, so it is the one to schedule.`,
    ];

    return {
      inFlight,
      released,
      expiringSoon,
      nextToBrew,
      headline: `${String(inFlight.length)} batch${inFlight.length === 1 ? "" : "es"} in the fermenter or on the bottling line, ${String(expiringSoon.length)} released batch${expiringSoon.length === 1 ? "" : "es"} inside four months of its best-before.`,
      findings,
    };
  }

  /* -------------------------------------------------------------- margins */

  async margins(): Promise<MarginReport> {
    const gstBp = await this.gstRateBp();
    const rows = await this.rows(
      `select v.sku, p.title, v.price_cents, v.unit_cost_cents,
              recent.cost_cents, recent.batches
         from public.product_variants v
         join public.products p on p.id = v.product_id
         left join lateral (
           select round(avg(b.unit_cost_cents))::int as cost_cents,
                  count(*)::int                      as batches
             from (
               select bb.unit_cost_cents
                 from public.batches bb
                where bb.variant_id = v.id
                  and bb.unit_cost_cents is not null
                  and bb.status in ('released', 'sold_out')
                order by coalesce(bb.released_at, bb.produced_at) desc nulls last
                limit 3
             ) b
         ) recent on true
        where v.deleted_at is null
        order by v.sku`,
    );

    const lines: MarginLine[] = rows.map((row) => {
      const priceCents = int(row, "price_cents");
      const batchCost = intOrNull(row, "cost_cents");
      const unitCostCents = batchCost ?? intOrNull(row, "unit_cost_cents");
      // GST-inclusive prices: the tax inside a price is price * rate / (10000 + rate).
      const gstCents = Math.round((priceCents * gstBp) / (10_000 + gstBp));
      const exGstCents = priceCents - gstCents;
      const marginPct =
        unitCostCents === null || exGstCents === 0
          ? null
          : round(((exGstCents - unitCostCents) / exGstCents) * 100);
      return {
        sku: str(row, "sku"),
        title: str(row, "title"),
        priceCents,
        unitCostCents,
        gstCents,
        exGstCents,
        marginPct,
        batchesUsed: int(row, "batches"),
        belowFloor: marginPct !== null && marginPct < MARGIN_FLOOR_PCT,
      };
    });

    const worst = lines
      .filter((line) => line.belowFloor && line.unitCostCents !== null)
      .sort((a, b) => (a.marginPct ?? 0) - (b.marginPct ?? 0))[0];
    const proposal =
      worst === undefined || worst.unitCostCents === null
        ? null
        : {
            sku: worst.sku,
            fromCents: worst.priceCents,
            // The price that restores the floor, rounded up to the next 50c.
            toCents:
              Math.ceil(
                ((worst.unitCostCents / (1 - MARGIN_FLOOR_PCT / 100)) *
                  (10_000 + gstBp)) /
                  10_000 /
                  50,
              ) * 50,
            reason: `${worst.title} is making ${pct(worst.marginPct ?? 0)} against a floor of ${pct(MARGIN_FLOOR_PCT, 0)}: unit cost is ${nzd(worst.unitCostCents)} and the GST-exclusive price is ${nzd(worst.exGstCents)}.`,
          };

    const findings = lines.map(
      (line) =>
        `${line.title} sells at ${nzd(line.priceCents)} (${nzd(line.gstCents)} of that is GST). ${
          line.unitCostCents === null
            ? "No unit cost recorded, so no margin can be stated."
            : `Unit cost ${nzd(line.unitCostCents)} from ${String(line.batchesUsed)} recent batch${line.batchesUsed === 1 ? "" : "es"}, margin ${pct(line.marginPct ?? 0)}${line.belowFloor ? " — below the floor" : ""}.`
        }`,
    );

    const below = lines.filter((line) => line.belowFloor).length;
    return {
      floorPct: MARGIN_FLOOR_PCT,
      lines,
      proposal,
      headline:
        below === 0
          ? `Every line is above the ${pct(MARGIN_FLOOR_PCT, 0)} margin floor.`
          : `${String(below)} line${below === 1 ? " is" : "s are"} under the ${pct(MARGIN_FLOOR_PCT, 0)} margin floor.`,
      findings,
    };
  }

  /* -------------------------------------------------------------- takings */

  async takings(windowDays: number): Promise<TakingsReport> {
    const rows = await this.rows(
      `select count(*)::int                                     as orders,
              coalesce(sum(o.total_cents), 0)::bigint           as gross,
              coalesce(sum(o.tax_cents), 0)::bigint             as gst,
              coalesce(sum(o.refunded_cents), 0)::bigint        as refunded,
              coalesce(sum(o.shipping_cents), 0)::bigint        as shipping,
              coalesce(sum(o.discount_cents), 0)::bigint        as discount,
              count(*) filter (where o.financial_status not in ('paid','partially_refunded','refunded'))::int as unpaid
         from public.orders o
        where o.status <> 'cancelled'
          and o.placed_at > now() - ($1::int * interval '1 day')`,
      [windowDays],
    );
    const row = rows[0] ?? {};
    const orders = int(row, "orders");
    const grossCents = int(row, "gross");
    const gstCents = int(row, "gst");

    const channelRows = await this.rows(
      `select o.channel, count(*)::int as orders,
              coalesce(sum(o.total_cents), 0)::bigint as gross
         from public.orders o
        where o.status <> 'cancelled'
          and o.placed_at > now() - ($1::int * interval '1 day')
        group by o.channel
        order by gross desc`,
      [windowDays],
    );

    const byChannel = channelRows.map((line) => ({
      channel: str(line, "channel"),
      orders: int(line, "orders"),
      grossCents: int(line, "gross"),
    }));

    const findings = [
      `${String(orders)} orders totalling ${nzd(grossCents)} in the last ${String(windowDays)} days.`,
      `${nzd(gstCents)} of that is GST collected, which is owed to Inland Revenue and is not takings.`,
      ...byChannel.map(
        (line) =>
          `${line.channel}: ${String(line.orders)} orders, ${nzd(line.grossCents)}.`,
      ),
      int(row, "refunded") === 0
        ? "Nothing was refunded in the window."
        : `${nzd(int(row, "refunded"))} was refunded.`,
    ];

    return {
      windowDays,
      orders,
      grossCents,
      gstCents,
      exGstCents: grossCents - gstCents,
      refundedCents: int(row, "refunded"),
      shippingCents: int(row, "shipping"),
      discountCents: int(row, "discount"),
      averageOrderCents: orders === 0 ? 0 : Math.round(grossCents / orders),
      byChannel,
      unpaid: int(row, "unpaid"),
      headline: `${nzd(grossCents)} across ${String(orders)} orders in ${String(windowDays)} days, of which ${nzd(gstCents)} is GST held for Inland Revenue.`,
      findings,
    };
  }

  /* -------------------------------------------------------- conversations */

  async openConversations(): Promise<ConversationReport> {
    const reviewRows = await this.rows(
      `select r.id, r.author_name, r.author_email, r.rating, r.title, r.body,
              v.sku, (now()::date - r.created_at::date)::int as waiting_days
         from public.reviews r
         left join public.product_variants v on v.id = r.variant_id
        where r.reply_body is null
          and r.status in ('published', 'pending')
        order by r.rating, r.created_at`,
    );
    const deliveryRows = await this.rows(
      `select o.id, o.order_number, o.email, coalesce(c.full_name, o.email) as who,
              (now()::date - o.placed_at::date)::int as waiting_days,
              o.fulfillment_status, o.financial_status
         from public.orders o
         left join public.customers c on c.id = o.customer_id
        where o.status = 'open'
          and o.fulfillment_status in ('unfulfilled', 'partially_fulfilled')
          and o.financial_status = 'paid'
          and o.placed_at < now() - ($1::int * interval '1 day')
        order by o.placed_at`,
      [FULFILMENT_GRACE_DAYS],
    );

    const emailByReview = new Map<string, string>();
    for (const row of reviewRows) {
      const address = strOrNull(row, "author_email");
      if (address !== null) emailByReview.set(str(row, "id"), address);
    }

    const open: OpenConversation[] = [
      ...reviewRows.map((row): OpenConversation => {
        const rating = intOrNull(row, "rating");
        return {
          kind: "review",
          id: str(row, "id"),
          who: str(row, "author_name"),
          sku: strOrNull(row, "sku"),
          rating,
          title: strOrNull(row, "title"),
          body: str(row, "body"),
          waitingDays: int(row, "waiting_days"),
          unhappy: rating !== null && rating <= 3,
        };
      }),
      ...deliveryRows.map(
        (row): OpenConversation => ({
          kind: "delivery",
          id: str(row, "id"),
          who: str(row, "who"),
          sku: null,
          rating: null,
          title: `Order ${str(row, "order_number")} is paid and not yet sent`,
          body: `Paid ${String(int(row, "waiting_days"))} days ago and still ${str(row, "fulfillment_status")}.`,
          waitingDays: int(row, "waiting_days"),
          unhappy: true,
        }),
      ),
    ];

    const unhappy = open.filter((item) => item.unhappy);
    const happiest = open.find((item) => !item.unhappy) ?? null;
    const nextCustomerEmail =
      happiest === null ? null : (emailByReview.get(happiest.id) ?? null);
    const proposal =
      happiest === null || happiest.kind !== "review"
        ? null
        : {
            reviewId: happiest.id,
            to: nextCustomerEmail ?? happiest.who,
            subject: `Reply to ${happiest.who}`,
            body: `Thanks for taking the time, ${happiest.who.split(" ")[0] ?? happiest.who}. ${happiest.sku === null ? "" : `Glad ${happiest.sku} is earning its place. `}If you want something to do with the last of the brine, the serves on the site start with the martini and the michelada.`,
            escalate: false,
          };

    const findings = open.map(
      (item) =>
        `${item.kind === "review" ? `${String(item.rating ?? 0)}-star review` : "Delivery"} from ${item.who}, waiting ${String(item.waitingDays)} day${item.waitingDays === 1 ? "" : "s"}: ${item.title ?? item.body.slice(0, 80)}${item.unhappy ? " — this one is not for an unattended reply." : ""}`,
    );

    return {
      open,
      unhappyCount: unhappy.length,
      nextCustomerEmail,
      proposal,
      headline:
        open.length === 0
          ? "Nobody is waiting on a reply."
          : `${String(open.length)} conversation${open.length === 1 ? "" : "s"} open, ${String(unhappy.length)} of which ${unhappy.length === 1 ? "is" : "are"} unhappy or late and must go to the founder.`,
      findings,
    };
  }

  async customerHistory(email: string): Promise<CustomerHistory> {
    const customerRows = await this.rows(
      `select c.id, c.full_name, c.email, c.customer_type, c.orders_count,
              c.total_spent_cents, c.first_ordered_at, c.last_ordered_at, c.note
         from public.customers c
        where lower(c.email) = lower($1)
        limit 1`,
      [email],
    );
    const found = customerRows[0];
    if (found === undefined) {
      return {
        customer: null,
        orders: [],
        reviews: [],
        headline: `No customer in the database with the address ${email}.`,
        findings: [],
      };
    }
    const customerId = str(found, "id");
    const orderRows = await this.rows(
      `select o.order_number, o.placed_at, o.total_cents, o.status,
              coalesce(string_agg(oi.title || ' x' || oi.quantity::text, ', '
                        order by oi.position), '') as items
         from public.orders o
         left join public.order_items oi on oi.order_id = o.id
        where o.customer_id = $1
        group by o.id, o.order_number, o.placed_at, o.total_cents, o.status
        order by o.placed_at desc
        limit 10`,
      [customerId],
    );
    const reviewRows = await this.rows(
      `select r.rating, r.title, r.replied_at
         from public.reviews r
        where r.customer_id = $1
        order by r.created_at desc`,
      [customerId],
    );

    const orders = orderRows.map((row) => ({
      orderNumber: str(row, "order_number"),
      placedAt: iso(row, "placed_at"),
      totalCents: int(row, "total_cents"),
      status: str(row, "status"),
      items: str(row, "items"),
    }));

    return {
      customer: {
        name: str(found, "full_name"),
        email: str(found, "email"),
        type: str(found, "customer_type"),
        ordersCount: int(found, "orders_count"),
        totalSpentCents: int(found, "total_spent_cents"),
        firstOrderedAt: iso(found, "first_ordered_at"),
        lastOrderedAt: iso(found, "last_ordered_at"),
        note: strOrNull(found, "note"),
      },
      orders,
      reviews: reviewRows.map((row) => ({
        rating: int(row, "rating"),
        title: strOrNull(row, "title"),
        repliedAt: iso(row, "replied_at"),
      })),
      headline: `${str(found, "full_name")} has ordered ${String(int(found, "orders_count"))} times and spent ${nzd(int(found, "total_spent_cents"))}.`,
      findings: orders.map(
        (order) =>
          `${order.orderNumber} on ${(order.placedAt ?? "").slice(0, 10)}: ${order.items} — ${nzd(order.totalCents)} (${order.status}).`,
      ),
    };
  }

  /* -------------------------------------------------------------- content */

  async contentPerformance(windowDays: number): Promise<ContentReport> {
    const rows = await this.rows(
      `select sp.id, sp.platform, sp.status, sp.caption, sp.published_at,
              coalesce(sp.impressions, 0)     as impressions,
              coalesce(sp.likes, 0)           as likes,
              coalesce(sp.comments_count, 0)  as comments,
              coalesce(sp.saves, 0)           as saves,
              coalesce(sp.shares, 0)          as shares,
              sp.brand_check_passed
         from public.social_posts sp
        where sp.created_at > now() - ($1::int * interval '1 day')
           or sp.status in ('draft', 'pending_approval', 'failed')
        order by sp.published_at desc nulls last, sp.created_at desc`,
      [windowDays],
    );

    const posts: PostLine[] = rows.map((row) => {
      const impressions = int(row, "impressions");
      const engagements =
        int(row, "likes") +
        int(row, "comments") +
        int(row, "saves") +
        int(row, "shares");
      return {
        id: str(row, "id"),
        platform: str(row, "platform"),
        status: str(row, "status"),
        caption: str(row, "caption"),
        publishedAt: iso(row, "published_at"),
        impressions,
        engagements,
        engagementRatePct:
          impressions === 0 ? null : round((engagements / impressions) * 100, 2),
        brandCheckPassed: boolOrNull(row, "brand_check_passed"),
      };
    });

    const published = posts.filter((post) => post.status === "published");
    const waiting = posts.filter(
      (post) => post.status === "pending_approval" || post.status === "draft",
    );
    const failed = posts.filter((post) => post.status === "failed");
    const ranked = [...published]
      .filter((post) => post.engagementRatePct !== null)
      .sort((a, b) => (b.engagementRatePct ?? 0) - (a.engagementRatePct ?? 0));
    const best = ranked[0] ?? null;
    const middle = ranked[Math.floor(ranked.length / 2)];
    const median = middle?.engagementRatePct ?? null;

    const proposal =
      best === null
        ? null
        : {
            platform: best.platform,
            caption: `${best.caption.split("\n")[0] ?? best.caption}`,
            sku: null,
            reason: `The post that worked hardest in the window ran at ${pct(best.engagementRatePct ?? 0, 2)} against a median of ${median === null ? "no median" : pct(median, 2)}. This drafts the same shape again, for the founder to approve or throw out.`,
          };

    return {
      windowDays,
      published,
      waiting,
      failed,
      bestPost: best,
      medianEngagementRatePct: median,
      proposal,
      headline: `${String(published.length)} posts published in the window, ${String(waiting.length)} waiting on a decision, ${String(failed.length)} failed to go out.`,
      findings: [
        ...published.map(
          (post) =>
            `${post.platform} on ${(post.publishedAt ?? "").slice(0, 10)}: ${String(post.impressions)} impressions, ${String(post.engagements)} engagements${post.engagementRatePct === null ? "" : ` (${pct(post.engagementRatePct, 2)})`}.`,
        ),
        ...failed.map(
          (post) =>
            `A ${post.platform} post failed to publish and nobody was told.`,
        ),
        ...posts
          .filter((post) => post.brandCheckPassed === false)
          .map((post) => `A ${post.platform} post failed its brand check.`),
      ],
    };
  }

  /* ------------------------------------------------------------ B2C sales */

  async salesBySku(windowDays: number): Promise<SalesReport> {
    const rows = await this.rows(
      `select oi.sku,
              max(oi.title)                                  as title,
              coalesce(sum(oi.quantity), 0)::int             as units,
              coalesce(sum(oi.line_total_cents), 0)::bigint  as revenue,
              count(distinct o.id)::int                      as orders,
              coalesce(prior.units, 0)::int                  as units_prior
         from public.order_items oi
         join public.orders o on o.id = oi.order_id
         left join lateral (
           select sum(pi.quantity) as units
             from public.order_items pi
             join public.orders po on po.id = pi.order_id
            where pi.sku = oi.sku
              and po.status <> 'cancelled'
              and po.placed_at <= now() - ($1::int * interval '1 day')
              and po.placed_at >  now() - ($1::int * 2 * interval '1 day')
         ) prior on true
        where o.status <> 'cancelled'
          and o.placed_at > now() - ($1::int * interval '1 day')
        group by oi.sku, prior.units
        order by units desc`,
      [windowDays],
    );

    const lines: SkuSalesLine[] = rows.map((row) => {
      const units = int(row, "units");
      const before = int(row, "units_prior");
      return {
        sku: str(row, "sku"),
        title: str(row, "title"),
        units,
        revenueCents: int(row, "revenue"),
        orders: int(row, "orders"),
        unitsPriorWindow: before,
        changePct: changePct(units, before),
      };
    });

    const channelRows = await this.rows(
      `select o.channel,
              coalesce(sum(oi.quantity), 0)::int            as units,
              coalesce(sum(oi.line_total_cents), 0)::bigint as revenue
         from public.order_items oi
         join public.orders o on o.id = oi.order_id
        where o.status <> 'cancelled'
          and o.placed_at > now() - ($1::int * interval '1 day')
        group by o.channel
        order by revenue desc`,
      [windowDays],
    );

    const repeatRows = await this.rows(
      `select count(*) filter (where c.orders_count > 1)::int as repeat,
              count(*)::int                                   as total
         from public.orders o
         join public.customers c on c.id = o.customer_id
        where o.status <> 'cancelled'
          and o.placed_at > now() - ($1::int * interval '1 day')`,
      [windowDays],
    );
    const repeatRow = repeatRows[0] ?? {};
    const total = int(repeatRow, "total");

    const totalRevenue = lines.reduce((sum, line) => sum + line.revenueCents, 0);

    // The campaign is aimed at whichever line fell hardest against the window
    // before it; if nothing fell, at the line that is carrying the range.
    const falling = [...lines]
      .filter((line) => line.changePct !== null && line.changePct < 0)
      .sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0))[0];
    const target = falling ?? lines[0];
    const proposal =
      target === undefined
        ? null
        : {
            slug: `campaign-${target.sku.toLowerCase()}`,
            subject: `${target.title}`,
            body: `${target.title} sold ${String(target.units)} bottles in the last ${String(windowDays)} days.`,
            audience: (falling === undefined ? "all" : "lapsed") as
              | "all"
              | "repeat"
              | "lapsed",
            reason:
              falling === undefined
                ? `${target.title} is carrying the range at ${String(target.units)} bottles, so the campaign goes to the whole list behind it.`
                : `${target.title} is down ${pct(Math.abs(target.changePct ?? 0))} on the ${String(windowDays)} days before, so the campaign goes to customers who have stopped ordering.`,
          };

    return {
      windowDays,
      lines,
      proposal,
      totalRevenueCents: totalRevenue,
      repeatCustomerPct:
        total === 0 ? null : round((int(repeatRow, "repeat") / total) * 100),
      byChannel: channelRows.map((row) => ({
        channel: str(row, "channel"),
        units: int(row, "units"),
        revenueCents: int(row, "revenue"),
      })),
      headline: `${nzd(totalRevenue)} across ${String(lines.reduce((sum, line) => sum + line.units, 0))} bottles in ${String(windowDays)} days.`,
      findings: lines.map(
        (line) =>
          `${line.title}: ${String(line.units)} bottles, ${nzd(line.revenueCents)}${line.changePct === null ? " (no comparable prior window)" : `, ${line.changePct >= 0 ? "up" : "down"} ${pct(Math.abs(line.changePct))} on the ${String(windowDays)} days before`}.`,
      ),
    };
  }

  /* ------------------------------------------------------------- B2B trade */

  private async accountLines(): Promise<readonly TradeAccountLine[]> {
    const rows = await this.rows(
      `select c.id, c.company_name, c.full_name, c.email, c.note,
              c.orders_count, c.total_spent_cents, c.last_ordered_at,
              (now()::date - c.last_ordered_at::date)::int as days_since,
              a.city,
              cadence.mean_days
         from public.customers c
         left join public.addresses a on a.id = c.default_address_id
         left join lateral (
           select case when count(*) > 1
                       then (extract(epoch from (max(o.placed_at) - min(o.placed_at)))
                             / 86400 / (count(*) - 1))
                  end as mean_days
             from public.orders o
            where o.customer_id = c.id and o.status <> 'cancelled'
         ) cadence on true
        where c.customer_type = 'wholesale' and c.deleted_at is null
        order by c.total_spent_cents desc nulls last`,
    );
    return rows.map((row) => {
      const daysSince = intOrNull(row, "days_since");
      const cadence =
        row["mean_days"] === null || row["mean_days"] === undefined
          ? null
          : round(num(row, "mean_days"));
      return {
        customerId: str(row, "id"),
        account: strOrNull(row, "company_name") ?? str(row, "full_name"),
        contact: strOrNull(row, "full_name"),
        email: str(row, "email"),
        city: strOrNull(row, "city"),
        ordersCount: int(row, "orders_count"),
        totalSpentCents: int(row, "total_spent_cents"),
        lastOrderedAt: iso(row, "last_ordered_at"),
        daysSinceLastOrder: daysSince,
        reorderCadenceDays: cadence,
        overdue:
          daysSince !== null &&
          cadence !== null &&
          daysSince > Math.round(cadence * 1.5),
        note: strOrNull(row, "note"),
      };
    });
  }

  async tradeAccounts(): Promise<TradeReport> {
    const accounts = await this.accountLines();
    const overdue = accounts.filter((account) => account.overdue);
    const target =
      overdue[0] ??
      [...accounts]
        .filter((account) => account.daysSinceLastOrder !== null)
        .sort(
          (a, b) =>
            (b.daysSinceLastOrder ?? 0) - (a.daysSinceLastOrder ?? 0),
        )[0];

    const proposal =
      target === undefined
        ? null
        : {
            customerId: target.customerId,
            account: target.account,
            to: target.email,
            subject: `${target.account} — restock before the next service`,
            body: [
              `${target.contact ?? "Hello"},`,
              "",
              `Your last order was ${target.daysSinceLastOrder === null ? "not recorded" : `${String(target.daysSinceLastOrder)} days ago`}${target.reorderCadenceDays === null ? "" : `, against your usual ${String(target.reorderCadenceDays)} days between orders`}.`,
              "A case is six bottles and trade pricing is the one published number.",
              "Say how many cases and I will get them on the next run.",
            ].join("\n"),
            reason:
              target.overdue === true
                ? `${target.account} is past its own reorder cadence.`
                : `${target.account} has gone the longest without ordering.`,
          };

    return {
      accounts,
      overdueCount: overdue.length,
      proposal,
      headline:
        accounts.length === 0
          ? "There are no wholesale accounts in the database yet."
          : `${String(accounts.length)} wholesale account${accounts.length === 1 ? "" : "s"}, ${String(overdue.length)} past their own reorder pattern.`,
      findings: accounts.map(
        (account) =>
          `${account.account}${account.city === null ? "" : ` (${account.city})`}: ${String(account.ordersCount)} orders, ${nzd(account.totalSpentCents)} all up, last ordered ${account.daysSinceLastOrder === null ? "never" : `${String(account.daysSinceLastOrder)} days ago`}${account.reorderCadenceDays === null ? "" : ` against a ${String(account.reorderCadenceDays)}-day pattern`}${account.overdue ? " — overdue" : ""}.`,
      ),
    };
  }

  async accountMemory(customerId: string): Promise<AccountMemory> {
    const accounts = await this.accountLines();
    const account =
      accounts.find((line) => line.customerId === customerId) ?? null;

    const emailRows = await this.rows(
      `select e.sent_at, e.scheduled_for, e.kind, e.subject, e.status,
              coalesce(e.open_count, 0) as opens, e.body_text
         from public.email_sends e
        where e.customer_id = $1
        order by coalesce(e.sent_at, e.scheduled_for, e.created_at) desc`,
      [customerId],
    );
    const orderRows = await this.rows(
      `select o.order_number, o.placed_at, o.total_cents,
              coalesce(string_agg(oi.title || ' x' || oi.quantity::text, ', '
                        order by oi.position), '') as items
         from public.orders o
         left join public.order_items oi on oi.order_id = o.id
        where o.customer_id = $1
        group by o.id, o.order_number, o.placed_at, o.total_cents
        order by o.placed_at desc`,
      [customerId],
    );
    const approvalRows = await this.rows(
      `select ap.requested_at, ap.subject_type, ap.status, ap.title
         from public.approvals ap
        where ap.subject_id = $1
        order by ap.requested_at desc`,
      [customerId],
    );

    const conversations = emailRows.map((row) => ({
      at: iso(row, "sent_at") ?? iso(row, "scheduled_for"),
      channel: str(row, "kind"),
      subject: str(row, "subject"),
      status: str(row, "status"),
      opened: int(row, "opens") > 0,
      extract: str(row, "body_text").slice(0, 240),
    }));

    return {
      account,
      conversations,
      orders: orderRows.map((row) => ({
        orderNumber: str(row, "order_number"),
        placedAt: iso(row, "placed_at"),
        totalCents: int(row, "total_cents"),
        items: str(row, "items"),
      })),
      decisions: approvalRows.map((row) => ({
        at: iso(row, "requested_at") ?? "",
        subject: str(row, "subject_type"),
        status: str(row, "status"),
        title: str(row, "title"),
      })),
      headline:
        account === null
          ? `No wholesale account with id ${customerId}.`
          : `${account.account}: ${String(orderRows.length)} orders and ${String(conversations.length)} prior message${conversations.length === 1 ? "" : "s"} on file.`,
      findings: [
        ...(account?.note === null || account?.note === undefined
          ? []
          : [`Standing note: ${account.note}`]),
        ...conversations.map(
          (line) =>
            `${(line.at ?? "").slice(0, 10)} ${line.channel}: "${line.subject}" — ${line.status}${line.opened ? ", opened" : ", not opened"}.`,
        ),
      ],
    };
  }

  /* -------------------------------------------------- product development */

  async rangeSignals(windowDays: number): Promise<RangeReport> {
    const sales = await this.salesBySku(windowDays);
    const themeRows = await this.rows(
      `select v.sku, max(p.title) as title, count(*)::int as reviews,
              round(avg(r.rating), 2) as average, min(r.rating)::int as lowest,
              string_agg(coalesce(r.title, left(r.body, 60)), ' | ') as quotes
         from public.reviews r
         join public.product_variants v on v.id = r.variant_id
         join public.products p on p.id = v.product_id
        where r.status = 'published'
        group by v.sku
        order by average asc nulls last`,
    );
    const recipeRows = await this.rows(
      `select name, status, batch_size_litres, is_current
         from public.recipes
        order by is_current desc, name`,
    );
    const ingredientRows = await this.rows(
      `select code, name, stock_on_hand, unit
         from public.ingredients
        where is_active and stock_on_hand > 0
        order by name`,
    );

    const themes: ReviewThemeLine[] = themeRows.map((row) => ({
      sku: str(row, "sku"),
      title: str(row, "title"),
      reviews: int(row, "reviews"),
      averageRating:
        row["average"] === null ? null : round(num(row, "average"), 2),
      lowest: intOrNull(row, "lowest"),
      quotes: str(row, "quotes").split(" | ").filter(Boolean).slice(0, 4),
    }));

    const leader = sales.lines[0];
    const laggard = sales.lines[sales.lines.length - 1];
    const proposal =
      leader === undefined
        ? null
        : {
            workingName: `${leader.title} at trade strength`,
            basedOnSku: leader.sku,
            rationale: `${leader.title} is the range's best seller at ${String(leader.units)} bottles in ${String(windowDays)} days${laggard === undefined || laggard.sku === leader.sku ? "" : `, against ${String(laggard.units)} for ${laggard.title}`}. A concentrate of the same brine is the cheapest new SKU to try, because the recipe, the supplier list and the bottle are already in the system.`,
            ingredients: ingredientRows
              .slice(0, 6)
              .map((row) => str(row, "name"))
              .join(", "),
          };

    return {
      windowDays,
      sales: sales.lines,
      themes,
      recipes: recipeRows.map((row) => ({
        name: str(row, "name"),
        status: str(row, "status"),
        batchSizeLitres:
          row["batch_size_litres"] === null
            ? null
            : round(num(row, "batch_size_litres"), 1),
        isCurrent: row["is_current"] === true,
      })),
      ingredientsOnHand: ingredientRows.map((row) => ({
        code: str(row, "code"),
        name: str(row, "name"),
        onHand: round(num(row, "stock_on_hand"), 2),
        unit: str(row, "unit"),
      })),
      proposal,
      headline:
        leader === undefined
          ? "No sales in the window, so there is nothing to reason from."
          : `${leader.title} leads the range at ${String(leader.units)} bottles in ${String(windowDays)} days; ${themes[0] === undefined ? "no review pattern yet" : `${themes[0].title} carries the lowest average rating at ${String(themes[0].averageRating ?? 0)}`}.`,
      findings: [
        ...sales.findings,
        ...themes.map(
          (theme) =>
            `${theme.title}: ${String(theme.reviews)} reviews, average ${String(theme.averageRating ?? 0)}, lowest ${String(theme.lowest ?? 0)}. Said: ${theme.quotes.join("; ")}`,
        ),
      ],
    };
  }

  /* ------------------------------------------------------------- the week */

  async weeklyPulse(): Promise<WeeklyPulse> {
    const rows = await this.rows(
      `select
         coalesce(sum(o.total_cents) filter (
           where o.placed_at > now() - interval '7 days'), 0)::bigint  as revenue,
         coalesce(sum(o.total_cents) filter (
           where o.placed_at <= now() - interval '7 days'
             and o.placed_at >  now() - interval '14 days'), 0)::bigint as revenue_prior,
         count(*) filter (where o.placed_at > now() - interval '7 days')::int as orders,
         count(*) filter (
           where o.placed_at <= now() - interval '7 days'
             and o.placed_at >  now() - interval '14 days')::int        as orders_prior,
         count(*) filter (
           where o.status = 'open' and o.fulfillment_status = 'unfulfilled')::int as unfulfilled
       from public.orders o
      where o.status <> 'cancelled'`,
    );
    const row = rows[0] ?? {};

    const newRows = await this.rows(
      `select count(*)::int as n from public.customers
        where first_ordered_at > now() - interval '7 days'`,
    );
    const decisionRows = await this.rows(
      `select count(*)::int as n from public.approvals where status = 'pending'`,
    );
    const failureRows = await this.rows(
      `select count(*)::int as n from public.agent_runs
        where status = 'failed' and queued_at > now() - interval '7 days'`,
    );

    const sales = await this.salesBySku(7);
    const cover = await this.coverLines(28);
    const ranked = [...cover]
      .filter((line) => line.daysOfCover !== null)
      .sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0));

    const revenue = int(row, "revenue");
    const revenuePrior = int(row, "revenue_prior");
    const change = changePct(revenue, revenuePrior);
    const best = sales.lines[0];
    const weakest = sales.lines[sales.lines.length - 1];
    const lowest = ranked[0];
    const decisions = int(decisionRows[0] ?? {}, "n");
    const failures = int(failureRows[0] ?? {}, "n");

    const opening = [
      `The last seven days took ${nzd(revenue)} across ${String(int(row, "orders"))} orders`,
      change === null
        ? ""
        : `, ${change >= 0 ? "up" : "down"} ${pct(Math.abs(change))} on the week before`,
      ".",
      best === undefined
        ? ""
        : ` ${best.title} carried it at ${String(best.units)} bottles.`,
      decisions === 0 ? "" : ` ${String(decisions)} decisions are waiting on you.`,
      failures === 0 ? "" : ` ${String(failures)} agent runs failed this week.`,
      lowest === undefined || lowest.daysOfCover === null
        ? ""
        : ` ${lowest.sku} is the thinnest at ${String(lowest.daysOfCover)} days of cover.`,
    ].join("");

    return {
      weekTo: new Date().toISOString().slice(0, 10),
      revenueCents: revenue,
      revenuePriorCents: revenuePrior,
      revenueChangePct: change,
      orders: int(row, "orders"),
      ordersPrior: int(row, "orders_prior"),
      newCustomers: int(newRows[0] ?? {}, "n"),
      repeatCustomerPct: sales.repeatCustomerPct,
      bestSku:
        best === undefined ? null : { sku: best.sku, units: best.units },
      weakestSku:
        weakest === undefined
          ? null
          : { sku: weakest.sku, units: weakest.units },
      decisionsWaiting: decisions,
      failedRuns: failures,
      unfulfilledOrders: int(row, "unfulfilled"),
      lowestCover:
        lowest === undefined
          ? null
          : { sku: lowest.sku, daysOfCover: lowest.daysOfCover },
      openingSentence: opening,
      headline: opening,
      findings: [
        `Takings: ${nzd(revenue)} this week against ${nzd(revenuePrior)} last week.`,
        `Orders: ${String(int(row, "orders"))} this week against ${String(int(row, "orders_prior"))} last week.`,
        `${String(int(newRows[0] ?? {}, "n"))} customers ordered for the first time.`,
        ...sales.findings,
        `${String(decisions)} decisions are waiting, ${String(failures)} agent runs failed, ${String(int(row, "unfulfilled"))} paid orders are still to pack.`,
      ],
    };
  }
}
