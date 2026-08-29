import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

import { AssetError } from "../errors";
import {
  assertSafeKey,
  type ByteRange,
  type ObjectStream,
  type StoredObject,
  type StorageProvider,
} from "./provider";

/**
 * The library on this machine's disk.
 *
 * This is the implementation the admin runs on today, and it is complete: put,
 * head, ranged read, delete. It is not in `public/`, deliberately — a file under
 * `public/` is served by Next to anyone who guesses the URL, with no session
 * check, and half of these photographs have other people in them. Everything
 * here is reachable only through the authenticated route handler in
 * `app/(admin)/admin/assets/file/[...key]/route.ts`.
 *
 * Two defences against a key escaping its root, because path traversal is the
 * classic way an upload store becomes an arbitrary file read:
 *
 *   1. `assertSafeKey` refuses `..`, backslashes, absolute paths and anything
 *      that is not lowercase-and-slashes.
 *   2. every resolved path is then checked to still be inside the root, so a
 *      symlink or a normalisation quirk cannot get past step 1 either.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local" as const;
  readonly location: string;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.location = `this machine, under ${this.root}`;
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    const prefix = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (!full.startsWith(prefix)) {
      throw new AssetError(
        "invalid_storage_key",
        "That file reference points outside the library.",
        { key },
      );
    }
    return full;
  }

  async put(key: string, bytes: Uint8Array): Promise<StoredObject> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    // Write to a scratch name and rename, so a crash mid-write cannot leave a
    // half-file that the checksum in the database claims is whole.
    const scratch = `${full}.${randomUUID()}.part`;
    await writeFile(scratch, bytes);
    await rename(scratch, full);
    return { key, byteSize: bytes.length };
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const info = await stat(this.resolve(key));
      return info.isFile() ? { key, byteSize: info.size } : null;
    } catch {
      return null;
    }
  }

  async read(
    key: string,
    range?: ByteRange | null,
  ): Promise<ObjectStream | null> {
    const head = await this.head(key);
    if (head === null) return null;
    const full = this.resolve(key);
    const stream =
      range === undefined || range === null
        ? createReadStream(full)
        : createReadStream(full, { start: range.start, end: range.end });
    return {
      key,
      totalBytes: head.byteSize,
      range: range ?? null,
      body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    };
  }

  async bytes(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.resolve(key)));
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
