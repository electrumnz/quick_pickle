import { NextResponse } from "next/server";

import { searchEverything } from "@/components/admin/data/search";
import { getAdminSession } from "@/lib/auth/server";

/**
 * What the command palette calls as she types.
 *
 * It re-checks the session rather than trusting the proxy: the matcher covers
 * `/admin/:path*` today, and a route that answers questions about the business
 * should not depend on a matcher pattern staying the way it is.
 *
 * It never throws at the caller. A search that cannot reach the database
 * returns an empty result set, and the palette still lists the nine
 * destinations — a broken search must not break navigation.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const state = await getAdminSession();
  if (state.status !== "authenticated") {
    return NextResponse.json(
      { query: "", hits: [] },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const results = await searchEverything(query);
    return NextResponse.json(results, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { query, hits: [] },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
