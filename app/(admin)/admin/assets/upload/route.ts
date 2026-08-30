import { AssetError, MAX_UPLOAD_BYTES, megabytes } from "@/lib/assets";
import { ingestFiles, type UploadedFile } from "@/lib/assets/ingest";
import { assetLibrary } from "@/lib/assets/server";
import {
  ADMIN_CSRF_FIELD_NAME,
  ADMIN_CSRF_HEADER_NAME,
  assertAdminCsrf,
  getAdminSession,
} from "@/lib/auth/server";

/**
 * `POST /admin/assets/upload` — the only way bytes get in.
 *
 * A route handler rather than a Server Action, for two reasons: an action's
 * body is size-limited in a way a photo library cannot live with, and a plain
 * `Response` is something a test can inspect byte for byte.
 *
 * There is no anonymous path here and no second one. The session is checked
 * (again — the proxy already did), the CSRF token is checked from either the
 * header or the form field, and only then is a byte read. What happens after
 * that is `lib/assets/ingest.ts`, which is where the sniffing, the size caps,
 * the metadata scrub and the deduplication live.
 *
 * It answers twice over: JSON for the enhanced form, and a redirect back to the
 * library with a count for a browser with no JavaScript, which is the same
 * upload minus the poster frame.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface UploadReport {
  readonly status: "stored" | "duplicate" | "rejected";
  readonly filename: string;
  readonly title?: string;
  readonly message?: string;
  readonly notes?: readonly string[];
  readonly href?: string;
}

export async function POST(request: Request): Promise<Response> {
  const session = await getAdminSession();
  if (session.status !== "authenticated") {
    return json({ message: "Not signed in." }, 403);
  }

  try {
    await assertAdminCsrf(request.headers.get(ADMIN_CSRF_HEADER_NAME));
  } catch {
    // The form field is the fallback, for the no-JavaScript path. It is read
    // from a clone so the body is still available to parse afterwards.
    try {
      const form = await request.clone().formData();
      const submitted = form.get(ADMIN_CSRF_FIELD_NAME);
      await assertAdminCsrf(typeof submitted === "string" ? submitted : null);
    } catch {
      return json(
        { message: "That form has expired. Reload and try again." },
        403,
      );
    }
  }

  const declaredLength = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
    return json(
      {
        message: `That upload is ${megabytes(declaredLength)}, and the limit is ${megabytes(MAX_UPLOAD_BYTES)} at a time.`,
      },
      413,
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ message: "The upload did not arrive in one piece." }, 400);
  }

  const chosen = form
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (chosen.length === 0) {
    return respond(request, [], "Choose a photo or a clip first.");
  }

  const files: UploadedFile[] = [];
  for (const [index, file] of chosen.entries()) {
    const poster = form.get(`poster-${String(index)}`);
    files.push({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      declaredMimeType: file.type,
      poster:
        poster instanceof File && poster.size > 0
          ? {
              bytes: new Uint8Array(await poster.arrayBuffer()),
              filename: poster.name,
              declaredMimeType: poster.type,
            }
          : null,
    });
  }

  const library = assetLibrary();
  try {
    const outcomes = await ingestFiles(
      files,
      {
        occasion: string(form, "occasion"),
        occasionOn: string(form, "occasionOn"),
        description: string(form, "description"),
        tags: string(form, "tags"),
        peoplePresent: form.get("peoplePresent") !== null,
      },
      {
        store: library.store,
        storage: library.storage,
        drafter: library.drafter,
        operatorId: session.session.operatorId,
      },
    );

    const reports: UploadReport[] = outcomes.map((outcome, index) => {
      const filename = files[index]?.filename ?? "file";
      if (outcome.status === "rejected") {
        return {
          status: "rejected",
          filename,
          message: outcome.message,
        };
      }
      return {
        status: outcome.status,
        filename,
        title: outcome.asset.title,
        notes: outcome.notes,
        href: `/admin/assets/${outcome.asset.id}`,
      };
    });
    return respond(request, reports, null);
  } catch (cause) {
    if (cause instanceof AssetError) {
      return json({ message: cause.message }, 400);
    }
    console.error(
      "[assets] upload failed:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return json(
      {
        message:
          "The library could not store those just now. Nothing was added.",
      },
      500,
    );
  }
}

/** A GET here is a mistake or a probe, and says so the way the login route does. */
export function GET(): Response {
  return new Response("Upload files with POST.", {
    status: 405,
    headers: {
      allow: "POST",
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

function string(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

/**
 * JSON when the page asked for it, a redirect when a plain form posted.
 *
 * The no-JavaScript path cannot render a per-file result list, so it carries
 * the counts in the query string and the library page reads them back.
 */
function respond(
  request: Request,
  results: readonly UploadReport[],
  message: string | null,
): Response {
  const wantsJson = (request.headers.get("accept") ?? "").includes(
    "application/json",
  );
  if (wantsJson) {
    return json(
      message === null ? { results } : { results, message },
      message === null ? 200 : 400,
    );
  }
  const counts = {
    added: results.filter((result) => result.status === "stored").length,
    already: results.filter((result) => result.status === "duplicate").length,
    refused: results.filter((result) => result.status === "rejected").length,
  };
  const query = new URLSearchParams({
    added: String(counts.added),
    already: String(counts.already),
    refused: String(counts.refused),
  });
  return new Response(null, {
    status: 303,
    headers: {
      location: `/admin/assets?${query.toString()}`,
      "cache-control": "no-store",
    },
  });
}
