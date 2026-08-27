import { describe, expect, it } from "vitest";

import { MockProvider } from "@/lib/commerce/mock/provider";
import { seedCommerce } from "@/lib/commerce/seed";
import { createSchemaDatabase } from "@/lib/commerce/testing/pglite";

describe("smoke", () => {
  it("seeds and reads", async () => {
    const db = await createSchemaDatabase();
    const provider = new MockProvider({
      sql: db.sql,
      siteUrl: "http://localhost:3000",
    });
    const result = await seedCommerce(provider, db.sql);
    console.log("seed source", result.source, "orders", result.orderIds.length);
    const products = await provider.listProducts();
    console.log(
      JSON.stringify(
        products.nodes.map((p) => [
          p.handle,
          p.priceRange.min,
          p.availableForSale,
        ]),
        null,
        1,
      ),
    );
    const orders = await provider.listOrders({
      sortKey: "PROCESSED_AT",
      reverse: true,
    });
    console.log(
      orders.nodes.map((o) => [
        o.orderNumber,
        o.total.amountInMinorUnits,
        o.financialStatus,
        o.fulfillmentStatus,
        o.placedAt,
      ]),
    );
    expect(products.nodes.length).toBe(4);
    await provider.close();
  }, 120_000);
});
