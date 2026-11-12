import { currentStaff } from "@/lib/backstage/auth/current";
import { readFile } from "@/lib/backstage/files/storage";
import { getDb } from "@/lib/db/client";

/**
 * A file the back end keeps, for a signed-in member of staff: an email's
 * attachment, an email exactly as it arrived, a document.
 *
 * These are files strangers sent us, so the browser is told to treat every
 * one as a download and never to guess at what it is. The few picture types
 * that are safe to look at in a tab are shown in place, locked down, and
 * only when asked for with `?view=1`.
 */

const VIEWABLE = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const staff = await currentStaff();
  if (staff === null) {
    return new Response("Sign in to see that.", {
      status: 401,
      headers: { "cache-control": "private, no-store" },
    });
  }

  const { id } = await context.params;
  const found = /^fil_[a-z0-9]{8,40}$/.test(id)
    ? await readFile(await getDb(), id)
    : null;
  if (found === null) {
    return new Response("No such file.", {
      status: 404,
      headers: { "cache-control": "private, no-store" },
    });
  }

  const { file, bytes } = found;
  const inline =
    new URL(request.url).searchParams.get("view") === "1" &&
    VIEWABLE.has(file.contentType);
  // RFC 5987: the name survives whatever characters it has in it.
  const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`;

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": inline ? file.contentType : "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "content-disposition": disposition,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}
