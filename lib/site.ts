/**
 * Canonical public origin for the site, without a trailing slash.
 *
 * Resolution order:
 *  1. `NEXT_PUBLIC_SITE_URL`, an explicit override (custom domain, local dev).
 *  2. The Vercel production domain, on a production deployment.
 *  3. The per-deployment Vercel URL, so previews reference themselves.
 *  4. localhost, for `next dev` and CI.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return normalise(explicit);

  if (process.env.VERCEL_ENV === "production") {
    const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
    if (productionHost) return normalise(productionHost);
  }

  const deploymentHost = process.env.VERCEL_URL?.trim();
  if (deploymentHost) return normalise(deploymentHost);

  return `http://localhost:${process.env.PORT ?? "3000"}`;
}

function normalise(value: string): string {
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, "");
}
