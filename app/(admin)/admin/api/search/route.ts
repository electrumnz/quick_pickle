import { NextResponse } from "next/server";

import { searchEverything } from "@/components/admin/data/search";
import { hasAdminReadAccess } from "@/lib/auth/server";

/**
 * What the command palette calls as she types.
 *
 * It re-checks for itself rather than trusting the proxy: the matcher covers
 * `/admin/:path*` today, and a route that answers questions about the business
 * should not depend on a matcher pattern staying the way it is. It asks the
 * same question the pages ask — may this request READ the admin — so it opens
 * and closes with them rather than a step behind.
 *
 * It never throws at the caller. A search that cannot reach the database
 * returns an empty result set, and the palette still lists the nine
 * destinations — a broken search must not break navigation.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  // Read access, not a session: on a demonstration the admin is open and the
  // palette is how anyone gets around it, so a search that 401s would leave the
  // open door with no handle. This route only ever reads.
  if (!(await hasAdminReadAccess())) {
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
