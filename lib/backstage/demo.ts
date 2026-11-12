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
}
