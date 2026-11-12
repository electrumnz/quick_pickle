import { NextResponse, type NextRequest } from "next/server";

import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { getLink } from "@/lib/backstage/marketing/links";
import { qrPng, qrSvg } from "@/lib/backstage/marketing/qr";
import { hexOf } from "@/lib/brand/colours";
import { siteUrl } from "@/lib/site";

/**
 * A short link's QR code, as a file to download.
 *
 *   ?format=svg   a vector: for a printer, a flyer, a sign. The default.
 *   ?format=png   a picture: for anywhere a vector will not go.
 *
 * The code holds the link's own short address on this site and nothing
 * else, so every scan is counted and the link can be pointed somewhere new
 * after the flyers are printed. Navy squares on white: a scanner needs the
 * contrast, so this is one place the cream ground is not used.
 *
 * Staff only. `requireStaff` is the lock here as on every page.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  await requireStaff();
  const { id } = await context.params;

  let slug: string;
  try {
    const link = await execute(
      getLink,
      { id: decodeURIComponent(id) },
      await staffCaller(),
    );
    slug = link.slug;
  } catch (error) {
    if (error instanceof OpError) {
      return new NextResponse("No such link.", { status: 404 });
    }
    throw error;
  }

  const address = `${siteUrl()}/go/${slug}`;
  const colours = { dark: hexOf("navy"), light: hexOf("white") };
  const png = request.nextUrl.searchParams.get("format") === "png";
  const name = `quick-pickle-qr-${slug}.${png ? "png" : "svg"}`;
  const headers = {
    "Content-Type": png ? "image/png" : "image/svg+xml; charset=utf-8",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (png) {
    const bytes = qrPng(address, colours, 24);
    // A fresh buffer of exactly these bytes: the body has to own its memory.
    const body = new Uint8Array(bytes.length);
    body.set(bytes);
    return new NextResponse(body.buffer, { headers });
  }
  return new NextResponse(qrSvg(address, colours), { headers });
}
