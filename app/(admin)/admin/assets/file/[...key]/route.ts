import { AssetError, parseRange } from "@/lib/assets";
import { assetLibrary } from "@/lib/assets/server";
import { getAdminSession } from "@/lib/auth/server";

/**
 * `GET /admin/assets/file/<key>` — the bytes.
 *
 * Serving a file somebody uploaded, from the same origin as the admin, is the
 * dangerous half of an upload feature. This is how that risk is managed here,
 * in the order the decisions were made.
 *
 * **1. SVG and HTML are not in the library at all.** The strongest control is
 * upstream: `lib/assets/formats.ts` accepts eight raster and video formats by
 * signature, and an SVG — a document that can carry script and fetch things —
 * is refused outright rather than sanitised. There is no stored file whose
 * content type can execute in a browsing context.
 *
 * **2. The content type comes from the database.** Never from the request,
 * never from the object store, never from the filename. The value in the row is
 * the one sniffing produced when the bytes arrived.
 *
 * **3. The response is inert even if (1) and (2) were both wrong.** It carries
 * `X-Content-Type-Options: nosniff` so a browser cannot re-guess the type,
 * `Content-Security-Policy: default-src 'none'; sandbox` so any document that
 * did somehow render has no script, no origin and no network, `Content-Disposition`
 * with a filename this library generated, and `Cross-Origin-Resource-Policy:
 * same-origin` so no other site can even embed it.
 *
 * **4. It is behind the session.** The proxy guards `/admin/:path*`, and the
 * session is checked again here, because a matcher is a configuration file and
 * this is a lock. An unauthenticated request gets a 404, not a 401: whether a
 * particular file exists is itself not public.
 *
 * The remaining exposure is that these bytes share an origin with the admin.
 * The complete answer to that is to serve them from somewhere else, and this
 * build ships that too: set `ASSET_STORAGE_PROVIDER=supabase` and the files live
 * in a private Supabase bucket on `<project>.supabase.co`. The local provider is
 * what runs today, because there is no Supabase project to point at yet and the
 * library has to work without one.
 */

export const dynamic = "force-dynamic";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

function guarded(headers: Headers): Headers {
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "default-src 'none'; sandbox");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-robots-tag", "noindex, nofollow");
  // These are photographs of the founder's customers. They do not go in a
  // shared cache, and they do not outlive the session in a private one.
  headers.set("cache-control", "private, no-store, max-age=0");
  return headers;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const session = await getAdminSession();
  if (session.status !== "authenticated") return notFound();

  const { key: segments } = await context.params;
  const key = segments.join("/");

  try {
    const library = assetLibrary();
    const file = await library.store.fileByKey(key);
    if (file === null) return notFound();

    const head = await library.storage.head(key);
    if (head === null) return notFound();

    const range = parseRange(request.headers.get("range"), head.byteSize);
    const object = await library.storage.read(key, range);
    if (object === null) return notFound();

    const headers = guarded(new Headers());
    headers.set("content-type", file.mimeType);
    headers.set(
      "content-disposition",
      `inline; filename="${safeName(file.downloadName)}"`,
    );
    headers.set("accept-ranges", "bytes");

    if (range === null) {
      headers.set("content-length", String(head.byteSize));
      return new Response(object.body, { status: 200, headers });
    }

    headers.set("content-length", String(range.end - range.start + 1));
    headers.set(
      "content-range",
      `bytes ${String(range.start)}-${String(range.end)}/${String(head.byteSize)}`,
    );
    return new Response(object.body, { status: 206, headers });
  } catch (cause) {
    // A key that this library did not issue is a 404 like any other miss: it
    // tells a prober nothing, and the refusal is already recorded upstream.
    if (cause instanceof AssetError) return notFound();
    console.error(
      "[assets] could not serve a file:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return new Response("The file could not be read.", {
      status: 500,
      headers: guarded(
        new Headers({ "content-type": "text/plain; charset=utf-8" }),
      ),
    });
  }
}

/** ASCII, no quotes, no control characters — a header value, not a filename. */
function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100);
  return cleaned === "" ? "file" : cleaned;
}
