/**
 * Every route this suite audits, in one list.
 *
 * The accessibility pass, the no-JavaScript pass and the coverage test in
 * `tests/a11y/coverage.test.ts` all read this file, so a page cannot be added
 * to the app and quietly miss the audit: the coverage test walks `app/(site)`
 * and `app/(admin)` and fails when a route it finds is neither listed here nor
 * excluded with a written reason.
 */

/** A route the browser visits, and the name it is reported under. */
export type AuditRoute = {
  readonly name: string;
  readonly path: string;
  /**
   * True when the page is one a stranger can reach. Everything else needs a
   * signed-in session and is audited through the admin project.
   */
  readonly signedIn?: true;
};

/** The four bottles and the box, as `/products/[handle]` resolves them. */
export const PRODUCT_HANDLES: readonly string[] = [
  "no-01-house",
  "no-02-dirty",
  "no-03-smoke",
  "no-04-wild",
  "the-full-set",
];

/**
 * One recipe, as a sample of `/recipes/[slug]`.
 *
 * The library has thirty-odd entries drawn from one template, so auditing all
 * of them measures the same markup thirty times. The slug is asserted to exist
 * in `tests/a11y/coverage.test.ts`, so this cannot rot into a 404 silently.
 */
export const SAMPLE_RECIPE_SLUG = "dirty-martini";

export const PUBLIC_ROUTES: readonly AuditRoute[] = [
  { name: "home", path: "/" },
  { name: "shop", path: "/shop" },
  ...PRODUCT_HANDLES.map((handle) => ({
    name: `product ${handle}`,
    path: `/products/${handle}`,
  })),
  { name: "recipes", path: "/recipes" },
  {
    name: `recipe ${SAMPLE_RECIPE_SLUG}`,
    path: `/recipes/${SAMPLE_RECIPE_SLUG}`,
  },
  { name: "wholesale", path: "/wholesale" },
  { name: "delivery", path: "/delivery" },
  { name: "terms", path: "/terms" },
  { name: "login", path: "/login" },
];

export const ADMIN_ROUTES: readonly AuditRoute[] = [
  { name: "today", path: "/admin", signedIn: true },
  { name: "chat", path: "/admin/chat", signedIn: true },
  { name: "orders", path: "/admin/orders", signedIn: true },
  { name: "stock", path: "/admin/stock", signedIn: true },
  { name: "social", path: "/admin/social", signedIn: true },
  { name: "customers", path: "/admin/customers", signedIn: true },
  { name: "money", path: "/admin/money", signedIn: true },
  { name: "assets", path: "/admin/assets", signedIn: true },
  { name: "brand", path: "/admin/brand", signedIn: true },
  { name: "brand audience", path: "/admin/brand/audience", signedIn: true },
  { name: "brand market", path: "/admin/brand/market", signedIn: true },
  { name: "brand messaging", path: "/admin/brand/messaging", signedIn: true },
  { name: "brand plan", path: "/admin/brand/plan", signedIn: true },
  { name: "team", path: "/admin/team", signedIn: true },
  { name: "settings", path: "/admin/settings", signedIn: true },
  { name: "go live", path: "/admin/go-live", signedIn: true },
  { name: "search", path: "/admin/search?q=smoke", signedIn: true },
  { name: "not found", path: "/admin/no-such-page", signedIn: true },
];

/**
 * Routes under `app/` that this suite deliberately does not audit, each with
 * the reason. `tests/a11y/coverage.test.ts` reads this map, so removing a
 * reason is not something that can happen by accident.
 */
export const UNAUDITED_ROUTES: Readonly<Record<string, string>> = {
  "/lab/bottle":
    "A developer instrument for the WebGL bottle, not a customer surface. It is a canvas and a control panel from `leva`, a third-party dev tool whose markup this repository does not own.",
  "/lab/tokens":
    "The design-token specimen sheet — a developer instrument that exists to be looked at while building, not a page the shop links to.",
  "/products":
    "A permanent redirect to /shop. There is no document to audit; `e2e/seo.spec.ts` covers that it still redirects.",
  "/admin/team/[slug]":
    "One agent's detail page, rendered by the same components as /admin/team, which is audited. Auditing it needs a live agent slug and measures the same markup twice.",
  "/admin/assets/[id]":
    "One asset's detail page, rendered by the same components as /admin/assets, which is audited. It needs a seeded asset id to reach.",
  "/checkout/mock/[id]":
    "The simulated checkout. It is audited — the form, a refused submission and the receipt are all in the `a11y buy states` block of e2e/a11y.spec.ts — but it cannot be audited from THIS list: the path is one cart's id and the query string is that cart's bearer token, so it only exists after a bottle has been put in a cart, and no static path can carry it.",
};
