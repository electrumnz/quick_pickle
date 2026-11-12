import { NextResponse, type NextRequest } from "next/server";

import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { booksFile } from "@/lib/backstage/numbers/books";

/**
 * Sales for the books, as a file. Asked for by a form's button (a POST),
 * never by a link: the by-order file is written in the activity log, and a
 * page fetched ahead of time must not be able to do that.
 */

const PAGE = "/backstage/numbers/books";

export async function POST(request: NextRequest): Promise<NextResponse> {
  await requireStaff(PAGE);
  const form = await request.formData();
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const from = field("from");
  const to = field("to");
  try {
    const made = await execute(
      booksFile,
      { from, to, kind: field("kind") === "orders" ? "orders" : "days" },
      await staffCaller(),
    );
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
    if (!(error instanceof OpError)) throw error;
    const back = new URL(PAGE, request.url);
    back.searchParams.set("from", from);
    back.searchParams.set("to", to);
    back.searchParams.set("notice", error.message);
    back.searchParams.set("tone", "bad");
    return NextResponse.redirect(back, 303);
  }
}
