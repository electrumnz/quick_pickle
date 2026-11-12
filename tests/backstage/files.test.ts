import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fileBlobs, files } from "@/db/schema";
import {
  deleteFile,
  fileInfo,
  FileTooLargeError,
  MAX_FILE_BYTES,
  readFile,
  saveFile,
  tidyFilename,
} from "@/lib/backstage/files/storage";
import { closeDb, openEmbedded, type DbHandle } from "@/lib/db/client";

let handle: DbHandle;

beforeAll(async () => {
  handle = await openEmbedded();
});

afterAll(async () => {
  await handle.close();
  await closeDb();
});

describe("file storage", () => {
  it("keeps the bytes exactly and gives them back", async () => {
    const bytes = new Uint8Array(1024);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 7) % 256;

    const saved = await saveFile(handle.db, {
      kind: "attachment",
      filename: "invoice 12.pdf",
      contentType: "Application/PDF",
      bytes,
    });
    expect(saved.id).toMatch(/^fil_/);
    expect(saved.size).toBe(1024);
    expect(saved.contentType).toBe("application/pdf");
    expect(saved.sha256).toMatch(/^[0-9a-f]{64}$/);

    const back = await readFile(handle.db, saved.id);
    expect(back).not.toBeNull();
    expect(back?.file.filename).toBe("invoice 12.pdf");
    expect(Array.from(back?.bytes ?? [])).toEqual(Array.from(bytes));

    expect((await fileInfo(handle.db, saved.id))?.kind).toBe("attachment");
  });

  it("answers null for a file that is not there", async () => {
    expect(await readFile(handle.db, "fil_nope")).toBeNull();
    expect(await fileInfo(handle.db, "fil_nope")).toBeNull();
  });

  it("refuses a file too big for the database, and saves nothing", async () => {
    const before = await handle.db.select({ id: files.id }).from(files);
    await expect(
      saveFile(handle.db, {
        kind: "document",
        filename: "huge.bin",
        contentType: "application/octet-stream",
        bytes: new Uint8Array(MAX_FILE_BYTES + 1),
      }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
    const after = await handle.db.select({ id: files.id }).from(files);
    expect(after.length).toBe(before.length);
  });

  it("deletes the index row and the bytes together", async () => {
    const saved = await saveFile(handle.db, {
      kind: "document",
      filename: "note.txt",
      contentType: "text/plain",
      bytes: new TextEncoder().encode("kia ora"),
    });
    await deleteFile(handle.db, saved.id);
    expect(await readFile(handle.db, saved.id)).toBeNull();
    const blobs = await handle.db
      .select({ key: fileBlobs.key })
      .from(fileBlobs)
      .where(eq(fileBlobs.key, `db/${saved.id}`));
    expect(blobs).toHaveLength(0);
  });

  it("rolls the bytes back with the transaction that saved them", async () => {
    let id = "";
    await expect(
      handle.db.transaction(async (tx) => {
        const saved = await saveFile(tx, {
          kind: "mail-raw",
          filename: "message.eml",
          contentType: "message/rfc822",
          bytes: new TextEncoder().encode("Subject: hi\r\n\r\nbody"),
        });
        id = saved.id;
        throw new Error("changed my mind");
      }),
    ).rejects.toThrow("changed my mind");
    expect(await readFile(handle.db, id)).toBeNull();
  });
});

describe("tidyFilename", () => {
  it("strips paths, control characters and leading dots", () => {
    expect(tidyFilename("../../etc/passwd")).toBe("etc passwd");
    expect(tidyFilename("..hidden")).toBe("hidden");
    expect(tidyFilename('a\r\nb"c.txt')).toBe("a b c.txt");
    expect(tidyFilename("   ")).toBe("file");
  });

  it("keeps macrons and other letters", () => {
    expect(tidyFilename("Ōtaki order.pdf")).toBe("Ōtaki order.pdf");
  });

  it("caps the length", () => {
    expect(tidyFilename("x".repeat(500)).length).toBe(180);
  });
});
