import { NextResponse, type NextRequest } from "next/server";

import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { courierFile } from "@/lib/backstage/orders/courier";
import { withNotice } from "@/lib/backstage/ui/notice";

/**
 * The file of orders for the courier's website, as a download.
 *
 * It is asked for by a form's button (a POST), never by a link: making the
 * file writes a line in the activity log, and a page a browser fetches ahead
 * of time must not be able to do that. The lock is the same as any page's.
 */

const PAGE = "/backstage/orders/courier";

function back(request: NextRequest, notice: string): NextResponse {
  const to = new URL(withNotice(PAGE, notice, "bad"), request.url);
  // 303: come back with a GET, whatever the form sent.
  return NextResponse.redirect(to, 303);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  await requireStaff(PAGE);
  const form = await request.formData();
  try {
    const made = await execute(
      courierFile,
      {
        which: form.get("which") === "open" ? "open" : "packed",
        includeTests: form.get("tests") === "yes",
      },
      await staffCaller(),
    );
    if (made.orders.length === 0) {
      return back(request, "Nothing is waiting, so there is no file to make.");
    }
    return new NextResponse(made.file, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${made.name}"`,
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    if (error instanceof OpError) return back(request, error.message);
    throw error;
  }
}
