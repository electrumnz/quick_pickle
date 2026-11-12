import type { Db } from "@/lib/db/types";

/**
 * The invented records a demo deployment starts with. Each area adds its own
 * here as it is built.
 */
export async function seedDemoData(db: Db): Promise<void> {
  const now = new Date();
  const { seedDemoOrders } = await import("./orders/demo");
  await seedDemoOrders(db, now);
  const { seedMarketingDemo } = await import("./marketing/demo");
  await seedMarketingDemo(db, now);
  const { seedPlansDemo } = await import("./plans/demo");
  await seedPlansDemo(db, now);
  const { seedPagesDemo } = await import("./pages/demo");
  await seedPagesDemo(db, now);
  // After every demo that places an order (orders, marketing and pages):
  // stock gives each one already packed or sent the batch it came from.
  // Any sooner and a later demo could not pack its own orders, because with
  // two batches on sale packing has to say which one is in the box.
  const { seedStockDemo } = await import("./stock/demo");
  await seedStockDemo(db, now);
  // Last, because it fills in the visits that led to the orders above.
  const { seedNumbersDemo } = await import("./numbers/demo");
  await seedNumbersDemo(db, now);
}
