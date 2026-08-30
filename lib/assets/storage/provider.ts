/**
 * `StorageProvider` — where the bytes live.
 *
 * Same shape of decision as `lib/commerce/provider.ts`: there is a service this
 * project will eventually use (Supabase Storage) and a service it does not have
 * today (there is no Supabase project provisioned), so the app is written
 * against a port, and the implementation is chosen by an environment variable.
 * The local-filesystem implementation is not a stub or a mock — it is a complete
 * implementation, and it is what the founder's library actually runs on right
 * now. Switching to the cloud is one variable, and nothing above this line
 * changes.
 *
 * ## The rules this interface is built from
 *
 * **A key is opaque, and it is ours.** Callers never build a key from a
 * filename. `assetObjectKey` derives it from the content hash, so the key is
 * unguessable-ish, collision-free, and carries nothing an uploader chose.
 * {@link assertSafeKey} is enforced on every call, in every implementation.
 *
 * **The store never decides a content type.** It holds bytes. The MIME type
 * comes from the database row, which got it from sniffing the bytes on the way
 * in. A store that told us what type a file was would be a store an uploader
 * could lie through.
 *
 * **Reads are streamed and range-aware.** A 200 MB video served by loading it
 * into a string would be a denial of service with extra steps, and `<video>`
 * scrubbing needs range requests to work at all.
 */

import { AssetError } from "../errors";
import type { StorageBackend } from "../types";

export interface StoredObject {
  readonly key: string;
  readonly byteSize: number;
}

export interface ByteRange {
  /** First byte, inclusive. */
  readonly start: number;
  /** Last byte, inclusive — HTTP's convention, kept end to end. */
  readonly end: number;
}

export interface ObjectStream {
  readonly key: string;
  /** Total size of the object, whatever was asked for. */
  readonly totalBytes: number;
  /** The range actually served, or null for the whole object. */
  readonly range: ByteRange | null;
  readonly body: ReadableStream<Uint8Array>;
}

export interface StorageProvider {
  readonly name: StorageBackend;
  /** One sentence for the admin: where these files are, in plain English. */
  readonly location: string;

  put(key: string, bytes: Uint8Array): Promise<StoredObject>;
  head(key: string): Promise<StoredObject | null>;
  read(key: string, range?: ByteRange | null): Promise<ObjectStream | null>;
  /** Whole object in memory. For posters and tests, never for video. */
  bytes(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
}

/**
 * Keys are lowercase, slash-separated, and end in an extension.
 *
 * @throws {AssetError} `invalid_storage_key` for anything with a traversal
 * segment, a backslash, a leading slash, a control character, or a length that
 * no legitimate key reaches.
 */
export function assertSafeKey(key: string): void {
  const bad = (why: string): never => {
    throw new AssetError(
      "invalid_storage_key",
      `That file reference is not one this library issued (${why}).`,
      { key: key.slice(0, 120) },
    );
  };
  if (key.length === 0 || key.length > 200) bad("length");
  if (!/^[a-z0-9][a-z0-9/_.-]*$/.test(key)) bad("characters");
  if (key.includes("..")) bad("traversal");
  if (key.includes("//")) bad("empty segment");
  if (key.startsWith("/") || key.endsWith("/")) bad("slash");
  if (!/\.[a-z0-9]{2,5}$/.test(key)) bad("no extension");
}

/**
 * The key for a stored file: content-addressed, foldered by month.
 *
 * The hash is the name, so the same photo uploaded twice lands on the same key
 * and the deduplication in the database and the object store agree by
 * construction rather than by bookkeeping.
 */
export function assetObjectKey(input: {
  readonly checksum: string;
  readonly extension: string;
  readonly at: Date;
  readonly prefix?: "photos" | "video" | "posters";
}): string {
  const year = input.at.getUTCFullYear().toString();
  const month = String(input.at.getUTCMonth() + 1).padStart(2, "0");
  const key = `${input.prefix ?? "photos"}/${year}/${month}/${input.checksum}.${input.extension}`;
  assertSafeKey(key);
  return key;
}

/**
 * Parse an HTTP `Range` header into a single satisfiable range.
 *
 * Only the single-range form is honoured; a multipart range request gets the
 * whole object, which is legal and is what every browser copes with.
 */
export function parseRange(
  header: string | null,
  totalBytes: number,
): ByteRange | null {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    const length = Number.parseInt(rawEnd ?? "0", 10);
    if (!Number.isFinite(length) || length <= 0) return null;
    return { start: Math.max(0, totalBytes - length), end: totalBytes - 1 };
  }
  const start = Number.parseInt(rawStart ?? "0", 10);
  const end =
    rawEnd === "" ? totalBytes - 1 : Number.parseInt(rawEnd ?? "0", 10);
  if (!Number.isFinite(start) || start >= totalBytes) return null;
  return { start, end: Math.min(end, totalBytes - 1) };
}
