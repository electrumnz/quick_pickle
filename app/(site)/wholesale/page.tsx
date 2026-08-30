import type { Metadata } from "next";

import { WHOLESALE } from "@/components/site/copy";
import { signupParams } from "@/components/site/SignupForm";
import { WholesaleView } from "@/components/site/WholesaleView";

/**
 * /wholesale — the trade destination.
 *
 * Dynamic for two reasons, and neither is laziness. The masthead reads the cart
 * through the commerce provider, exactly as the shop and product pages do; and
 * the sample request is a plain `<form>` posting to a Server Action that answers
 * by redirecting back here with the outcome in the query string, which is what
 * makes it work with JavaScript switched off.
 *
 * Everything else on the page is derived from `content/brines.ts` at render
 * time and needs no database, so a build in an environment with no Postgres
 * still succeeds.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: WHOLESALE.title,
  description: WHOLESALE.metaDescription,
  openGraph: {
    type: "website",
    title: `${WHOLESALE.title} | Half Sour`,
    description: WHOLESALE.metaDescription,
    url: "./",
  },
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default async function WholesalePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  return <WholesaleView signup={signupParams((key) => first(params[key]))} />;
}
