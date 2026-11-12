import { defineConfig } from "drizzle-kit";

/**
 * Only used to GENERATE migrations from db/schema (`npm run db:generate`).
 * Nothing here connects to a database: applying migrations is done by
 * lib/db/migrate.ts, from SQL embedded in the build, so it works the same on
 * a laptop, in a test, in a preview with no database, and in production.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  casing: "snake_case",
});
