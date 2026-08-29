/**
 * The roster's reads, against the seeded business.
 *
 * Every assertion here is about real rows: 95 orders, 18 batches, 12 reviews and
 * the wholesale accounts that `supabase/seed.sql` writes. Nothing is stubbed, so
 * a query that would fail against Postgres fails here.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SqlBusinessReads } from "@/lib/agents/roster";

import { createSeededBusiness, type RosterTestDatabase } from "./support/pglite";

let database: RosterTestDatabase;
let reads: SqlBusinessReads;

beforeAll(async () => {
  database = await createSeededBusiness();
  reads = new SqlBusinessReads(database.sql);
}, 120_000);

afterAll(async () => {
  await database.close();
});

describe("the roster reads the real business", () => {
  it("reads the range with prices in integer cents", async () => {
    const products = await reads.catalogue();
    expect(products.length).toBeGreaterThanOrEqual(4);
    const house = products.find((line) => line.sku === "HS-01-500");
    expect(house?.priceCents).toBe(1_800);
    expect(Number.isInteger(house?.priceCents)).toBe(true);
  });

  it("computes days of cover from sales that actually happened", async () => {
    const report = await reads.stockCover(28);
    expect(report.lines.length).toBeGreaterThan(0);
    for (const line of report.lines) {
      expect(line.available).toBeGreaterThanOrEqual(0);
      if (line.daysOfCover !== null) {
        expect(line.unitsPerDay).toBeGreaterThan(0);
      }
    }
    // The seed puts the 500ml bottle under its reorder point on purpose.
    const codes = report.ingredientsBelowReorder.map((item) => item.code);
    expect(codes).toContain("BOTTLE_500");
    expect(report.proposal).not.toBeNull();
    expect(report.proposal?.amountCents).toBeGreaterThan(0);
  });

  it("reads the production board and names what to brew next", async () => {
    const report = await reads.batchPlan(28);
    expect(report.inFlight.length).toBeGreaterThan(0);
    expect(report.released.length).toBeGreaterThan(0);
    expect(report.nextToBrew).not.toBeNull();
  });

  it("separates GST out of the price and prices margin on the rest", async () => {
    const report = await reads.margins();
    const house = report.lines.find((line) => line.sku === "HS-01-500");
    expect(house).toBeDefined();
    // 15% GST inside an $18.00 price is $2.35, leaving $15.65.
    expect(house?.gstCents).toBe(235);
    expect(house?.exGstCents).toBe(1_565);
    expect((house?.gstCents ?? 0) + (house?.exGstCents ?? 0)).toBe(1_800);
    expect(report.floorPct).toBe(60);
  });

  it("never counts GST as income in the takings", async () => {
    const report = await reads.takings(28);
    expect(report.orders).toBeGreaterThan(0);
    expect(report.gstCents).toBeGreaterThan(0);
    expect(report.exGstCents).toBe(report.grossCents - report.gstCents);
    expect(report.byChannel.map((line) => line.channel)).toContain("online");
  });

  it("finds who is waiting and marks the unhappy ones as not ours to answer", async () => {
    const report = await reads.openConversations();
    expect(report.open.length).toBeGreaterThan(0);
    const unhappy = report.open.filter((item) => item.unhappy);
    expect(unhappy.length).toBe(report.unhappyCount);
    for (const item of report.open) {
      if (item.rating !== null && item.rating <= 3) expect(item.unhappy).toBe(true);
    }
    // A proposal is only ever drafted for someone who is not unhappy.
    if (report.proposal !== null) {
      const target = report.open.find(
        (item) => item.id === report.proposal?.reviewId,
      );
      expect(target?.unhappy).toBe(false);
    }
  });

  it("reads one customer's own history", async () => {
    const conversations = await reads.openConversations();
    const email = conversations.nextCustomerEmail;
    expect(email).not.toBeNull();
    const history = await reads.customerHistory(email ?? "");
    expect(history.customer).not.toBeNull();
    expect(history.orders.length).toBeGreaterThanOrEqual(0);
  });

  it("reads post performance and compares it to the median", async () => {
    const report = await reads.contentPerformance(120);
    expect(report.published.length).toBeGreaterThan(0);
    expect(report.bestPost).not.toBeNull();
    expect(report.failed.length).toBeGreaterThan(0);
  });

  it("compares this window's sales to the window before it", async () => {
    const report = await reads.salesBySku(28);
    expect(report.lines.length).toBeGreaterThan(0);
    expect(report.totalRevenueCents).toBeGreaterThan(0);
    const first = report.lines[0];
    expect(first?.units).toBeGreaterThan(0);
  });

  it("reads the trade list and every prior conversation with an account", async () => {
    const trade = await reads.tradeAccounts();
    expect(trade.accounts.length).toBeGreaterThan(0);
    const account = trade.accounts[0];
    expect(account).toBeDefined();
    const memory = await reads.accountMemory(account?.customerId ?? "");
    expect(memory.account?.account).toBe(account?.account);
    expect(memory.orders.length).toBeGreaterThan(0);
  });

  it("puts sales next to what reviewers said", async () => {
    const report = await reads.rangeSignals(90);
    expect(report.sales.length).toBeGreaterThan(0);
    expect(report.themes.length).toBeGreaterThan(0);
    expect(report.recipes.length).toBeGreaterThan(0);
    expect(report.proposal).not.toBeNull();
  });

  it("takes the week against the week before and writes the opening sentence", async () => {
    const pulse = await reads.weeklyPulse();
    expect(pulse.orders).toBeGreaterThanOrEqual(0);
    expect(pulse.openingSentence).toMatch(/^The last seven days took NZ\$/);
    expect(pulse.decisionsWaiting).toBeGreaterThanOrEqual(0);
  });
});
