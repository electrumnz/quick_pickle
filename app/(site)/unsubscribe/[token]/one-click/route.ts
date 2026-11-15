import { leaveBy } from "../leave";

/**
 * Where a mail program's own unsubscribe button posts (RFC 8058).
 *
 * Every campaign email names this address in its List-Unsubscribe header.
 * The POST is the request: no page, no sign-in, no cookie, and nothing in
 * the body is needed, because the token in the address is the proof. A GET
 * is somebody (or something) following the address as a link, so it is
 * sent to the page with the button and changes nothing.
 *
 * Answers:
 *   200  off the list, now or already
 *   404  not one of our links
 *   500  it did not go through; the mail program may try again
 */

export const dynamic = "force-dynamic";

const plain = (status: number, body: string) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  try {
    return (await leaveBy(token)) === "left"
      ? plain(200, "Unsubscribed.")
      : plain(404, "Not found.");
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "crew.one_click_failed",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    return plain(500, "That did not go through.");
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  return Response.redirect(
    new URL(`/unsubscribe/${encodeURIComponent(token)}`, request.url),
    303,
  );
}
