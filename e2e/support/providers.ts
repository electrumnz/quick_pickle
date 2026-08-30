/**
 * Which commerce provider a Playwright project is exercising.
 *
 * Deliberately free of side effects and of any import that has them, because
 * `playwright.config.ts` loads this file in the process that SPAWNS the web
 * servers. `e2e/support/commerce.ts` loads `.env.local` on import, and
 * `@next/env` stamps `__NEXT_PROCESSED_ENV` on any process it loads; a
 * `next start` that inherits that marker skips loading its own env files, and
 * then the values the config passes it are read differently than intended.
 * That cost an hour once. Keeping the naming here and the machinery there is
 * what stops it costing another.
 */

export const PROVIDER_PROJECT_PREFIX = "commerce-";

/** The provider a project is exercising, from its name. */
export function providerFromProjectName(projectName: string): string {
  return projectName.startsWith(PROVIDER_PROJECT_PREFIX)
    ? projectName.slice(PROVIDER_PROJECT_PREFIX.length)
    : "mock";
}

/**
 * The providers this run exercises, from `E2E_COMMERCE_PROVIDERS`.
 *
 * The whole reason `lib/commerce/provider.ts` exists is that the storefront
 * cannot tell which implementation it has, so the purchase journey is written
 * once and run once per name here.
 */
export function providersUnderTest(
  raw: string | undefined = process.env.E2E_COMMERCE_PROVIDERS,
): readonly string[] {
  const names = (raw ?? "mock,shopify")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== "");
  return names.length === 0 ? ["mock"] : names;
}
