import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { ShopPage } from "@/components/site/ShopPage";
import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { resolvePage, type LivePage } from "@/lib/backstage/pages/ops";

/**
 * A landing page: the one page with other words in the hero, for one
 * audience or one advert. /for/<slug>.
 *
 * Only what has been published is ever shown here, and publishing is the
 * step that runs the copy rules (lib/backstage/pages/ops.ts). A draft has
 * no public address at all.
 *
 * Three answers:
 *   - a live page: its words, over the same shop as everybody sees;
 *   - a page that exists but is not up (taken down, or still a draft): the
 *     standard page, at this address. An advert or a printed QR code may
 *     still point here, and a visitor who paid attention to it deserves the
 *     shop, not a dead end;
 *   - no such page: not found.
 *
 * Rendered once and kept for a minute, then checked again, so the page is
 * as quick as the standard one and a change shows within the minute
 * (publishing from the back end clears it at once). Search engines are
 * pointed at the standard page: a landing page is the same shop twice.
 */

export const revalidate = 60;
export const dynamicParams = true;

export function generateStaticParams(): { slug: string }[] {
  return [];
}

const VISITOR = systemCaller("The shop", "storefront");

const find = cache(async (slug: string): Promise<LivePage> => {
  try {
    return await execute(resolvePage, { slug }, VISITOR);
  } catch {
    // The database out of reach: the standard page is better than an error.
    return { found: false, known: true };
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await find(slug);
  return {
    ...(page.found ? { title: page.words.headline.split("\n").join(" ") } : {}),
    alternates: { canonical: "/" },
    robots: { index: false, follow: true },
  };
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await find(slug);
  if (page.found) return <ShopPage words={page.words} page={page.slug} />;
  if (page.known) return <ShopPage />;
  notFound();
}
