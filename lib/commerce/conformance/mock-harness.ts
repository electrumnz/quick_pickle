/**
 * The MockProvider conformance harness.
 *
 * Boots an in-process Postgres with the project's real migrations, seeds the
 * Half Sour fixture, and hands the suite a live provider plus the out-of-band
 * hooks it needs (set the stock, age a cart, corrupt a stored price).
 *
 * Every hook here reaches around the provider on purpose. `tamperLinePrice`
 * writing directly to `cart_items` is the only way to prove the claim that
 * matters most: that a price sitting in the database is not what the customer
 * is charged.
 */

import { MockProvider } from "../mock/provider";
import { SEED_LOCATIONS, SEED_VARIANTS, seedCommerce } from "../seed";
import type { SqlExecutor } from "../sql/executor";
import { createSchemaDatabase } from "../testing/pglite";
import type {
  ConformanceContext,
  ConformanceHarness,
  HookResult,
} from "./harness";

const CHECKOUT_EMAIL = "conformance.buyer@example.co.nz";

function splitCartId(cartId: string): string | null {
  const [id] = cartId.split("?key=");
  return id ?? null;
}

export function createMockHarness(): ConformanceHarness {
  let sql: SqlExecutor | null = null;

  return {
    name: "mock",

    async setUp(): Promise<ConformanceContext> {
      const database = await createSchemaDatabase();
      sql = database.sql;
      const provider = new MockProvider({
        sql: database.sql,
        siteUrl: "https://halfsour.test",
      });
      await seedCommerce(provider, database.sql);
      const executor = database.sql;

      return {
        providerName: "mock",
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
          await executor.transaction(async (tx) => {
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
          // `carts_expiry_after_creation` insists expires_at > created_at, so
          // the cart is aged rather than simply given a past expiry.
          await executor.query(
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
          const result = await executor.query(
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
          await executor.query(
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
      sql = null;
      void sql;
    },
  };
}
