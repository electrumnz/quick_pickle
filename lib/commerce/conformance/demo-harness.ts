/**
 * The demo-provider conformance harness.
 *
 * The point of running the suite here is not that the provider class is
 * different — it is the same class — but that the *database* is. This harness
 * opens the built image the way a deployment opens it, and then makes the
 * provider do all 100-odd things the contract says a provider must do. A schema
 * that survived `dumpDataDir` with a missing sequence, a broken trigger or a
 * dropped constraint fails here, at the same assertions that hold the mock and
 * will hold Shopify.
 *
 * The image ships with the platform seed — 95 orders, real recipes, the agent
 * history — and those are not the fixtures the cases assert on. So the harness
 * clears the schema and lays down the conformance fixture instead, exactly as
 * the mock harness does. The clear is derived from `pg_tables` rather than
 * written out, so a migration that adds a table cannot leave a stale row behind
 * for a case to trip over.
 */

import { ensureDemoImage } from "@/lib/demo/build";
import { openDemoImage } from "@/lib/demo/database";

import { MockProvider } from "../mock/provider";
import { SEED_LOCATIONS, SEED_VARIANTS, seedCommerce } from "../seed";
import type { SqlExecutor } from "../sql/executor";
import { createPgliteExecutor } from "../sql/pglite";
import type {
  ConformanceContext,
  ConformanceHarness,
  HookResult,
} from "./harness";

const CHECKOUT_EMAIL = "conformance.buyer@example.co.nz";

/** Empty every table in `public`, whatever the migrations have created. */
const CLEAR_PUBLIC = `
do $clear$
declare
  statement text;
begin
  select 'truncate table '
         || string_agg(format('%I.%I', schemaname, tablename), ', ')
         || ' restart identity cascade'
    into statement
    from pg_tables
   where schemaname = 'public';
  if statement is not null then
    execute statement;
  end if;
end;
$clear$;
`;

function splitCartId(cartId: string): string | null {
  const [id] = cartId.split("?key=");
  return id ?? null;
}

export function createDemoHarness(): ConformanceHarness {
  return {
    name: "demo",

    async setUp(): Promise<ConformanceContext> {
      await ensureDemoImage();
      const db = await openDemoImage();
      const sql: SqlExecutor = createPgliteExecutor(db);
      await sql.execScript(CLEAR_PUBLIC);

      const provider = new MockProvider({
        name: "demo",
        sql,
        siteUrl: "https://halfsour.test",
      });
      await seedCommerce(provider, sql);

      return {
        providerName: "demo",
        provider,
        fixtures: {
          stockedVariantId: SEED_VARIANTS.house,
          secondVariantId: SEED_VARIANTS.dirty,
          scarceVariantId: SEED_VARIANTS.smoke,
          stockedVariantSku: "HS-01-500",
          productHandle: "no-01-house",
          searchTerm: "dill",
          commonTag: "brine",
          exclusiveTag: "gift",
          collectionHandle: "brines",
          percentageCode: "WELCOME10",
          percentageBasisPoints: 1000,
          percentageMinimumCents: 4000,
          expiredCode: "LAUNCH20",
          unknownCode: "NOSUCHCODE1",
          checkoutEmail: CHECKOUT_EMAIL,
          checkoutAddress: {
            firstName: "Riley",
            lastName: "Ashcroft",
            line1: "3 Jervois Road",
            suburb: "Herne Bay",
            city: "Auckland",
            region: "Auckland",
            postcode: "1011",
            countryCode: "NZ",
            phone: "+64 21 555 019",
          },
        },

        async completeCheckout(cartId) {
          return provider.completeCheckout(cartId, {
            email: CHECKOUT_EMAIL,
            phone: "+64 21 555 019",
            shippingAddress: {
              firstName: "Riley",
              lastName: "Ashcroft",
              line1: "3 Jervois Road",
              suburb: "Herne Bay",
              city: "Auckland",
              region: "Auckland",
              postcode: "1011",
              countryCode: "NZ",
              phone: "+64 21 555 019",
            },
          });
        },

        async setStock(variantId, quantity): Promise<HookResult> {
          await sql.transaction(async (tx) => {
            await tx.query(
              `update public.inventory_levels il
                  set on_hand = il.committed
                 from public.inventory_locations l
                where l.id = il.location_id
                  and il.variant_id = $1
                  and l.is_active and l.ships_orders`,
              [variantId],
            );
            await tx.query(
              `insert into public.inventory_levels
                 (variant_id, location_id, provider, sync_status, on_hand)
               values ($1, $2, 'local', 'local', $3)
               on conflict (variant_id, location_id)
               do update set on_hand = public.inventory_levels.committed + $3`,
              [variantId, SEED_LOCATIONS.kitchen, quantity],
            );
          });
          return "applied";
        },

        async expireCart(cartId): Promise<HookResult> {
          const id = splitCartId(cartId);
          if (id === null) return "unsupported";
          await sql.query(
            `update public.carts
                set created_at = now() - interval '60 days',
                    expires_at = now() - interval '1 day'
              where id = $1`,
            [id],
          );
          return "applied";
        },

        async tamperLinePrice(
          cartId,
          variantId,
          unitPriceCents,
        ): Promise<HookResult> {
          const id = splitCartId(cartId);
          if (id === null) return "unsupported";
          const result = await sql.query(
            `update public.cart_items
                set unit_price_cents = $3
              where cart_id = $1 and variant_id = $2
              returning id`,
            [id, variantId, unitPriceCents],
          );
          return result.rows.length > 0 ? "applied" : "unsupported";
        },

        async tamperCartTotals(cartId, totalCents): Promise<HookResult> {
          const id = splitCartId(cartId);
          if (id === null) return "unsupported";
          await sql.query(
            `update public.carts
                set subtotal_cents = $2, discount_cents = 0, total_cents = $2
              where id = $1`,
            [id, totalCents],
          );
          return "applied";
        },
      };
    },

    async tearDown(context): Promise<void> {
      await context.provider.close();
    },
  };
}
