/**
 * The domain enumerations and the Postgres enums they mirror, compared.
 *
 * `OrderFulfillmentStatus` was written by hand and drifted three ways at once:
 * it had never gained `returned` or `cancelled`, and it carried `restocked`,
 * which is Shopify's word and has never been a value any column in this
 * database can hold. The seed contains a cancelled order, so the mock
 * provider threw on it and the admin had to route around whole screens.
 *
 * Nothing here restates the members. The expected list is read out of the
 * migration that creates the type, and the actual list is the tuple the domain
 * union is derived from, so a list added to on one side and not the other
 * fails here rather than in front of the shopkeeper. A test that named the
 * members itself would be a third copy, and would rot exactly the way the type
 * did.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CUSTOMER_TYPES,
  DISCOUNT_SCOPES,
  DISCOUNT_STATUSES,
  DISCOUNT_VALUE_TYPES,
  LOCATION_KINDS,
  ORDER_FINANCIAL_STATUSES,
  ORDER_FULFILLMENT_STATUSES,
  ORDER_STATUSES,
  PRODUCT_STATUSES,
  SALES_CHANNELS,
} from "@/lib/commerce/types";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

/**
 * Which domain tuple mirrors which Postgres type.
 *
 * The pairing is the only thing stated here; both member lists are read from
 * their sources.
 */
const MIRRORED = [
  { sqlType: "product_status", tuple: PRODUCT_STATUSES },
  { sqlType: "order_status", tuple: ORDER_STATUSES },
  { sqlType: "order_financial_status", tuple: ORDER_FINANCIAL_STATUSES },
  { sqlType: "order_fulfillment_status", tuple: ORDER_FULFILLMENT_STATUSES },
  { sqlType: "sales_channel", tuple: SALES_CHANNELS },
  { sqlType: "customer_type", tuple: CUSTOMER_TYPES },
  { sqlType: "location_kind", tuple: LOCATION_KINDS },
  { sqlType: "discount_type", tuple: DISCOUNT_VALUE_TYPES },
  { sqlType: "discount_scope", tuple: DISCOUNT_SCOPES },
  { sqlType: "discount_status", tuple: DISCOUNT_STATUSES },
] as const satisfies ReadonlyArray<{
  readonly sqlType: string;
  readonly tuple: readonly string[];
}>;

const CREATE_ENUM =
  /create\s+type\s+public\.(\w+)\s+as\s+enum\s*\(([\s\S]*?)\)\s*;/gi;
const MEMBER = /'([^']*)'/g;

function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(path.join(MIGRATIONS, name), "utf8"))
    .join("\n");
}

function parseEnums(sql: string): Map<string, readonly string[]> {
  const found = new Map<string, readonly string[]>();
  for (const match of sql.matchAll(CREATE_ENUM)) {
    const [, name = "", body = ""] = match;
    found.set(
      name,
      [...body.matchAll(MEMBER)].map(([, member]) => member!),
    );
  }
  return found;
}

const sql = migrationSql();
const enums = parseEnums(sql);

describe("domain enums match the database", () => {
  it("parsed the migrations at all", () => {
    // Without this, a regex that stopped matching would turn every assertion
    // below into a comparison against nothing and pass silently.
    expect(enums.size).toBeGreaterThan(20);
  });

  it("has no ALTER TYPE the parser would miss", () => {
    // Members added by a later migration rather than at CREATE TYPE would be
    // invisible above. None exist today; if one appears, this fails and the
    // parser needs teaching before it can be trusted again.
    expect(sql).not.toMatch(/alter\s+type\s+public\.\w+\s+add\s+value/i);
  });

  for (const { sqlType, tuple } of MIRRORED) {
    it(`public.${sqlType}`, () => {
      const schema = enums.get(sqlType);
      expect(
        schema,
        `public.${sqlType} is not created by any migration`,
      ).toBeDefined();

      const inSchema: string[] = [...schema!].sort();
      const inCode: string[] = [...tuple].sort();

      expect(
        inCode.filter((member) => !inSchema.includes(member)),
        `TypeScript invents members public.${sqlType} does not have`,
      ).toEqual([]);
      expect(
        inSchema.filter((member) => !inCode.includes(member)),
        `public.${sqlType} has members TypeScript cannot represent`,
      ).toEqual([]);
      expect(inCode).toEqual(inSchema);
    });
  }
});
