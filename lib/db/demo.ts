/**
 * Demo data, for a deployment that has no database yet.
 *
 * It exists so the back end can be walked through before the real database
 * is connected. Everything here is invented and lives in memory: it resets
 * when the server restarts, and two servers do not share it. The back end
 * says so on every screen while it is in this mode.
 *
 * Filled in area by area as the back end grows (see each area's `demo.ts`).
 */

import { demoMarker } from "@/db/schema";

import type { Db } from "./types";

export async function seedDemo(db: Db): Promise<void> {
  const existing = await db.select().from(demoMarker).limit(1);
  if (existing.length > 0) return;
  await db.insert(demoMarker).values({ id: 1, isDemo: true });
  const { seedDemoData } = await import("@/lib/backstage/demo");
  await seedDemoData(db);
}
