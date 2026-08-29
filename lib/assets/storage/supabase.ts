import { AssetError } from "../errors";
import {
  assertSafeKey,
  type ByteRange,
  type ObjectStream,
  type StoredObject,
  type StorageProvider,
} from "./provider";

export interface SupabaseStorageConfig {
  /** `https://<project>.supabase.co` — no trailing slash. */
  readonly url: string;
  /** Service-role key. Server-side only; it bypasses RLS by design. */
  readonly serviceKey: string;
  readonly bucket: string;
}

/**
 * The same library in Supabase Storage.
 *
 * Written against the Storage REST endpoint with `fetch` rather than through
 * `@supabase/supabase-js`, for one reason that matters here: the JS client's
 * `download()` reads a whole object into a Blob, and this interface promises
 * ranged reads. `fetch` passes a `Range` header straight through and Supabase
 * answers it with a 206, so scrubbing a video works the same way it does
 * locally.
 *
 * The bucket must be **private**. Serving these files from a public bucket
 * would put photographs of identifiable people on a guessable URL with no
 * session behind it, which is the exact failure the consent column exists to
 * make impossible. With a private bucket the admin route handler is still the
 * only way in, and the files come from a different origin
 * (`<project>.supabase.co`) than the admin itself — which is the stronger
 * answer to "never serve an uploaded file from the app's own origin".
 */
export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase" as const;
  readonly location: string;

  constructor(private readonly config: SupabaseStorageConfig) {
    this.location = `Supabase Storage, private bucket "${config.bucket}"`;
  }

  private endpoint(key: string): string {
    assertSafeKey(key);
    const base = this.config.url.replace(/\/+$/, "");
    return `${base}/storage/v1/object/${encodeURIComponent(this.config.bucket)}/${key
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  }

  private headers(extra: Readonly<Record<string, string>> = {}): HeadersInit {
    return {
      authorization: `Bearer ${this.config.serviceKey}`,
      apikey: this.config.serviceKey,
      ...extra,
    };
  }

  async put(key: string, bytes: Uint8Array): Promise<StoredObject> {
    const response = await fetch(this.endpoint(key), {
      method: "POST",
      headers: this.headers({
        // The store is told nothing about what the file is: the database holds
        // the sniffed type, and this is deliberately the generic one.
        "content-type": "application/octet-stream",
        "cache-control": "private, max-age=0",
        "x-upsert": "true",
      }),
      body: new Uint8Array(bytes) as unknown as BodyInit,
    });
    if (!response.ok) {
      throw new AssetError(
        "storage_unavailable",
        `Supabase Storage refused the upload (${String(response.status)}).`,
        { status: response.status },
      );
    }
    return { key, byteSize: bytes.length };
  }

  async head(key: string): Promise<StoredObject | null> {
    const response = await fetch(this.endpoint(key), {
      method: "HEAD",
      headers: this.headers(),
    });
    if (!response.ok) return null;
    const length = Number.parseInt(
      response.headers.get("content-length") ?? "",
      10,
    );
    return { key, byteSize: Number.isFinite(length) ? length : 0 };
  }

  async read(
    key: string,
    range?: ByteRange | null,
  ): Promise<ObjectStream | null> {
    const response = await fetch(this.endpoint(key), {
      headers: this.headers(
        range === undefined || range === null
          ? {}
          : { range: `bytes=${String(range.start)}-${String(range.end)}` },
      ),
    });
    if (!response.ok || response.body === null) return null;
    const total = totalFrom(response);
    return {
      key,
      totalBytes: total,
      range: range ?? null,
      body: response.body,
    };
  }

  async bytes(key: string): Promise<Uint8Array | null> {
    const response = await fetch(this.endpoint(key), {
      headers: this.headers(),
    });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    const response = await fetch(this.endpoint(key), {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!response.ok && response.status !== 404) {
      throw new AssetError(
        "storage_unavailable",
        `Supabase Storage refused the delete (${String(response.status)}).`,
        { status: response.status },
      );
    }
  }
}

function totalFrom(response: Response): number {
  const contentRange = response.headers.get("content-range");
  const match = contentRange === null ? null : /\/(\d+)$/.exec(contentRange);
  if (match?.[1] !== undefined) return Number.parseInt(match[1], 10);
  const length = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  return Number.isFinite(length) ? length : 0;
}
