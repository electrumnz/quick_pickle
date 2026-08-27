# Decisions taken unattended

Reversible calls made without the user while the campaign ran overnight.
Each records what was chosen, why, and what was NOT chosen, so any of them can be revisited.

| # | Decision | Chosen | Alternative not taken | Reversible? |
|---|---|---|---|---|
| 1 | Base branch for the PR | Created `main` at the scaffold commit via the GitHub API, so the feature branch has something to merge into | Leaving the repo with a single branch that is also the default, which makes a PR impossible | Yes — delete the branch |
| 2 | Hosting domain | Free Vercel domain | Buying halfsour.co.nz — explicitly forbidden by the user | Yes |

| 3 | Shopify tokens for the deployed app | Build the morning demo on MockProvider with real seeded data; ShopifyProvider ships complete but inactive | Waiting until tokens exist, which would leave nothing to show | Yes — flip COMMERCE_PROVIDER |

## Queued for the user — NOT actioned
- Purchase of `halfsour.co.nz` (and optionally `.com`, currently taken). User said not to buy.
- Renaming the Shopify store from "Picklin Jews" to the final brand. User granted permission,
  but it waits on A1's IPONZ trademark result so we rename once, not twice.
- Any paid Supabase project creation, if the schema needs a live database to verify against.


---

## BLOCKER — needs 2 minutes from the user, cannot be done by me

**The deployed site needs its own Shopify API tokens.** My Shopify connector authenticates me,
not the app. A deployed Next.js site on Vercel needs its own credentials, and creating them is
refused by policy: `storefrontAccessTokenCreate` returns
`access_escalation — Storefront access token management is not permitted via AI tools`.
That is a sensible guardrail and I have not tried to route around it.

This does not block the build. The commerce layer sits behind an adapter, so everything runs on
the mock provider with real seeded data and swaps to Shopify by changing one env var. But the
live store will not be connected until this is done.

### What to do (Shopify admin -> Settings -> Apps and sales channels -> Develop apps)
1. **Create an app**, name it something like "HALF SOUR storefront".
2. **Configure Storefront API scopes**: `unauthenticated_read_product_listings`,
   `unauthenticated_read_product_inventory`, `unauthenticated_read_selling_plans`,
   `unauthenticated_write_checkouts`, `unauthenticated_read_checkouts`.
3. **Configure Admin API scopes**: `read_products`, `write_products`, `read_orders`,
   `write_orders`, `read_inventory`, `write_inventory`, `read_customers`, `read_fulfillments`,
   `write_fulfillments`, `read_discounts`, `write_discounts`.
4. **Install the app**, then copy the two tokens.
5. Put them into the Vercel project `half-sour` env vars as `SHOPIFY_STOREFRONT_ACCESS_TOKEN`
   and `SHOPIFY_ADMIN_ACCESS_TOKEN`, then set `COMMERCE_PROVIDER=shopify`.

The Admin token is a full-write credential. It is server-only — it must never appear in a
`NEXT_PUBLIC_` variable or reach the browser.
