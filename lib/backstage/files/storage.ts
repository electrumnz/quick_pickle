/**
 * Where a file's bytes go, and how they come back.
 *
 * `files` (db/schema/files.ts) is the index: one row per file, with a `key`
 * that says where its bytes are. Today there is one place, the database
 * itself (keys starting `db/`, bytes in `file_blobs`), which is right for the
 * small things the back end keeps: an email exactly as it arrived, an
 * attachment, a document. It needs no extra service, and the in-process
 * database a test or a demo runs on has it too.
 *
 * Pictures and video for the public site are a different job (they want a
 * CDN) and will get their own place behind the same three functions.
 *
 * These take a transaction, so a file and the record that points at it are
 * saved together or not at all.
 */

import "server-only";

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { fileBlobs, files } from "@/db/schema";
import { newId } from "@/lib/db/id";
import type { DbOrTx } from "@/lib/db/types";

/** Bigger than this does not belong in the database. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export type FileKind = (typeof files.$inferSelect)["kind"];

export type StoredFile = {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
  readonly kind: FileKind;
  readonly sha256: string | null;
  readonly createdAt: Date;
};

export class FileTooLargeError extends Error {
  constructor(readonly size: number) {
    super(
      `That file is ${String(Math.ceil(size / 1024 / 1024))} MB. The most that can be kept is ${String(MAX_FILE_BYTES / 1024 / 1024)} MB.`,
    );
    this.name = "FileTooLargeError";
  }
}

/** A name that is safe to show and to hand back in a download header. */
export function tidyFilename(name: string): string {
  const cleaned = name
    .normalize("NFC")
    // Control characters, path separators and the characters a header or a
    // file system would trip on.
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ")
    // A word that is nothing but dots ("..") is a path trick, not a name.
    .replace(/(^|\s)\.+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return (cleaned === "" ? "file" : cleaned).slice(0, 180);
}

export async function saveFile(
  db: DbOrTx,
  input: {
    readonly kind: FileKind;
    readonly filename: string;
    readonly contentType: string;
    readonly bytes: Uint8Array;
    readonly createdBy?: string | null;
    readonly alt?: string;
    readonly rights?: string;
    readonly tags?: readonly string[];
  },
): Promise<StoredFile> {
  const size = input.bytes.byteLength;
  if (size > MAX_FILE_BYTES) throw new FileTooLargeError(size);

  const id = newId("fil");
  const key = `db/${id}`;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const filename = tidyFilename(input.filename);
  const contentType =
    input.contentType.trim().toLowerCase().slice(0, 120) ||
    "application/octet-stream";

  await db.insert(fileBlobs).values({ key, bytes: input.bytes });
  const [row] = await db
    .insert(files)
    .values({
      id,
      key,
      filename,
      contentType,
      size,
      sha256,
      kind: input.kind,
      alt: input.alt ?? "",
      rights: input.rights ?? "",
      tags: [...(input.tags ?? [])],
      createdBy: input.createdBy ?? null,
    })
    .returning();
  if (row === undefined) throw new Error("The file was not saved.");
  return toStored(row);
}

export async function fileInfo(
  db: DbOrTx,
  id: string,
): Promise<StoredFile | null> {
  const [row] = await db.select().from(files).where(eq(files.id, id)).limit(1);
  return row === undefined ? null : toStored(row);
}

export async function readFile(
  db: DbOrTx,
  id: string,
): Promise<{ readonly file: StoredFile; readonly bytes: Uint8Array } | null> {
  const [row] = await db.select().from(files).where(eq(files.id, id)).limit(1);
  if (row === undefined) return null;
  if (!row.key.startsWith("db/")) {
    throw new Error(`No way to read a file kept at "${row.key}".`);
  }
  const [blob] = await db
    .select({ bytes: fileBlobs.bytes })
    .from(fileBlobs)
    .where(eq(fileBlobs.key, row.key))
    .limit(1);
  if (blob === undefined) return null;
  return { file: toStored(row), bytes: new Uint8Array(blob.bytes) };
}

export async function deleteFile(db: DbOrTx, id: string): Promise<void> {
  const [row] = await db
    .delete(files)
    .where(eq(files.id, id))
    .returning({ key: files.key });
  if (row !== undefined) {
    await db.delete(fileBlobs).where(eq(fileBlobs.key, row.key));
  }
}

function toStored(row: typeof files.$inferSelect): StoredFile {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    kind: row.kind,
    sha256: row.sha256,
    createdAt: row.createdAt,
  };
}
