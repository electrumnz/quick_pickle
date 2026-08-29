/**
 * Shopify's fulfilment words, translated.
 *
 * `ShopifyProvider` does not exist yet (unit C1), so this covers the
 * translation on its own. It is here because the mistake it prevents has
 * already happened once: Shopify's `RESTOCKED` had been copied into the domain
 * union as `restocked`, where no column could produce it and every real
 * cancelled order threw.
 */

import { describe, expect, it } from "vitest";

import { isCommerceError } from "@/lib/commerce/errors";
import {
  SHOPIFY_QUERYABLE_FULFILLMENT_STATUSES,
  toOrderFulfillmentStatus,
} from "@/lib/commerce/shopify/fulfillment-status";
import { ORDER_FULFILLMENT_STATUSES } from "@/lib/commerce/types";

describe("Shopify fulfilment status translation", () => {
  it("maps the statuses that mean the same thing", () => {
    expect(
      toOrderFulfillmentStatus({ displayFulfillmentStatus: "UNFULFILLED" }),
    ).toBe("unfulfilled");
    expect(
      toOrderFulfillmentStatus({
        displayFulfillmentStatus: "PARTIALLY_FULFILLED",
      }),
    ).toBe("partially_fulfilled");
    expect(
      toOrderFulfillmentStatus({ displayFulfillmentStatus: "FULFILLED" }),
    ).toBe("fulfilled");
  });

  it("collapses the holding patterns onto unfulfilled", () => {
    for (const display of ["ON_HOLD", "SCHEDULED", "PENDING_FULFILLMENT"]) {
      expect(
        toOrderFulfillmentStatus({ displayFulfillmentStatus: display }),
      ).toBe("unfulfilled");
    }
  });

  it("reads delivery off the fulfilment, which Shopify has no order-level word for", () => {
    expect(
      toOrderFulfillmentStatus({
        displayFulfillmentStatus: "FULFILLED",
        deliveredAt: "2026-08-01T02:00:00.000Z",
      }),
    ).toBe("delivered");
  });

  it("calls a cancelled order cancelled however it still displays", () => {
    expect(
      toOrderFulfillmentStatus({
        displayFulfillmentStatus: "UNFULFILLED",
        cancelledAt: "2026-08-02T02:00:00.000Z",
      }),
    ).toBe("cancelled");
    // RESTOCKED on its own is not evidence the goods came back: cancelling
    // before dispatch restocks too.
    expect(
      toOrderFulfillmentStatus({
        displayFulfillmentStatus: "RESTOCKED",
        cancelledAt: "2026-08-02T02:00:00.000Z",
      }),
    ).toBe("cancelled");
  });

  it("separates a return from a cancellation", () => {
    expect(
      toOrderFulfillmentStatus({
        displayFulfillmentStatus: "RESTOCKED",
        cancelledAt: "2026-08-02T02:00:00.000Z",
        returnStatus: "RETURNED",
      }),
    ).toBe("returned");
    // A return in flight is not stock on the shelf yet.
    expect(
      toOrderFulfillmentStatus({
        displayFulfillmentStatus: "FULFILLED",
        returnStatus: "IN_PROGRESS",
      }),
    ).toBe("fulfilled");
  });

  it("refuses a status it has no translation for", () => {
    try {
      toOrderFulfillmentStatus({ displayFulfillmentStatus: "TELEPORTED" });
      expect.unreachable("an unknown Shopify status was silently accepted");
    } catch (error) {
      expect(isCommerceError(error)).toBe(true);
      expect((error as Error).message).toContain("TELEPORTED");
    }
  });

  it("only offers to query Shopify for statuses Shopify can answer", () => {
    const notQueryable = ORDER_FULFILLMENT_STATUSES.filter(
      (status) => !SHOPIFY_QUERYABLE_FULFILLMENT_STATUSES.includes(status),
    );
    expect([...notQueryable].sort()).toEqual([
      "cancelled",
      "delivered",
      "returned",
    ]);
  });
});
