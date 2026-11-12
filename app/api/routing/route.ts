import { NextResponse } from "next/server";

import { systemCaller } from "@/lib/backstage/core/actor";
import { execute } from "@/lib/backstage/core/op";
import { pagesRouting } from "@/lib/backstage/pages/routing-ops";
import { NO_ROUTING } from "@/lib/shop/routing";

/**
 * Who sees which page, for the thing in front of the shop (proxy.ts).
 *
 * It answers with the rules that are switched on and the test, if one is
 * running. Almost always that is nothing at all, and everybody sees the
 * standard page. It names pages and links, never a person, and none of it
 * is secret: it is what the site does in public anyway.
 *
 * If the database cannot be reached it answers "nothing set up". The front
 * page showing the standard page is always a better failure than the front
 * page not showing.
 */

export const dynamic = "force-dynamic";

const SHOP = systemCaller("The shop", "storefront");

export async function GET(): Promise<NextResponse> {
  let routing: { rules: unknown; test: unknown; asksBuyer?: boolean } = {
    ...NO_ROUTING,
    asksBuyer: false,
  };
  try {
    routing = await execute(pagesRouting, {}, SHOP);
  } catch {
    // Left as nothing.
  }
  return NextResponse.json(routing, {
    headers: {
      // Asked for again a few seconds later, not on every visit.
      "Cache-Control": "public, max-age=0, s-maxage=10",
      "X-Robots-Tag": "noindex",
    },
  });
}
