/**
 * The storage port, and the two ways a file store gets turned into an arbitrary
 * file read: a key that climbs out of its root, and a key that was never issued
 * by the library at all.
 */

import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AssetError } from "@/lib/assets/errors";
import { LocalStorageProvider } from "@/lib/assets/storage/local";
import {
  assertSafeKey,
  assetObjectKey,
  parseRange,
} from "@/lib/assets/storage/provider";
import {
  createStorageProvider,
  readStorageConfig,
} from "@/lib/assets/storage/registry";

let root = "";
let storage: LocalStorageProvider;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "half-sour-storage-"));
  storage = new LocalStorageProvider(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const KEY = "photos/2026/09/" + "a".repeat(64) + ".jpg";

async function bodyOf(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined) chunks.push(value);
  }
  const out = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

describe("the local provider", () => {
  it("round-trips a file", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const stored = await storage.put(KEY, bytes);
    expect(stored.byteSize).toBe(10);
    expect(await storage.head(KEY)).toEqual({ key: KEY, byteSize: 10 });
    expect(await storage.bytes(KEY)).toEqual(bytes);
    expect(await readFile(path.join(root, KEY))).toEqual(Buffer.from(bytes));
  });

  it("serves a byte range, which is what a video needs to scrub", async () => {
    const stream = await storage.read(KEY, { start: 3, end: 5 });
    expect(stream?.totalBytes).toBe(10);
    expect(await bodyOf(stream?.body ?? new ReadableStream())).toEqual(
      new Uint8Array([4, 5, 6]),
    );
  });

  it("returns null rather than throwing for a key that is not there", async () => {
    expect(
      await storage.head("photos/2026/09/" + "b".repeat(64) + ".jpg"),
    ).toBeNull();
    expect(
      await storage.read("photos/2026/09/" + "b".repeat(64) + ".jpg"),
    ).toBeNull();
  });

  it("deletes", async () => {
    await storage.remove(KEY);
    expect(await storage.head(KEY)).toBeNull();
    await storage.remove(KEY); // twice is fine
  });
});

describe("keys the library did not issue", () => {
  const rejected = [
    "../../../etc/passwd",
    "photos/../../etc/passwd.jpg",
    "/etc/passwd.jpg",
    "photos\\2026\\09\\x.jpg",
    "photos//2026/x.jpg",
    "Photos/2026/09/x.jpg",
    "photos/2026/09/x",
    "",
    `photos/${"x".repeat(300)}.jpg`,
  ];

  for (const key of rejected) {
    it(`refuses ${JSON.stringify(key)}`, () => {
      expect(() => assertSafeKey(key)).toThrowError(AssetError);
    });
  }

  it("refuses to read one, rather than resolving it and finding nothing", async () => {
    await expect(storage.read("../../../etc/passwd")).rejects.toThrowError(
      /not one this library issued/i,
    );
  });

  it("cannot be reached even when the file really is out there", async () => {
    const outside = path.join(root, "..", "outside-secret.txt");
    await writeFile(outside, "not yours");
    await expect(storage.bytes("../outside-secret.txt")).rejects.toThrow();
    await rm(outside, { force: true });
  });

  it("issues keys that are content-addressed and safe by construction", () => {
    const key = assetObjectKey({
      checksum: "c".repeat(64),
      extension: "jpg",
      at: new Date("2026-09-14T00:00:00Z"),
      prefix: "photos",
    });
    expect(key).toBe(`photos/2026/09/${"c".repeat(64)}.jpg`);
    expect(() => assertSafeKey(key)).not.toThrow();
  });
});

describe("choosing a provider", () => {
  it("runs on local disk with no configuration at all", () => {
    const config = readStorageConfig({});
    expect(config.backend).toBe("local");
    const provider = createStorageProvider(config);
    expect(provider.name).toBe("local");
    expect(provider.location).toContain(path.join(process.cwd(), ".assets"));
  });

  it("keeps files out of public/, where they would be served with no session", () => {
    const config = readStorageConfig({});
    expect(config.directory).not.toContain(`${path.sep}public${path.sep}`);
    expect(config.directory.endsWith(`${path.sep}public`)).toBe(false);
  });

  it("refuses a provider name it does not know, rather than falling back", () => {
    expect(() =>
      readStorageConfig({ ASSET_STORAGE_PROVIDER: "s4" }),
    ).toThrowError(/not a storage provider/i);
  });

  it("names exactly what is missing for Supabase Storage", () => {
    expect(() =>
      createStorageProvider(
        readStorageConfig({ ASSET_STORAGE_PROVIDER: "supabase" }),
      ),
    ).toThrowError(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("builds the Supabase provider when it is configured", () => {
    const provider = createStorageProvider(
      readStorageConfig({
        ASSET_STORAGE_PROVIDER: "supabase",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
        ASSET_STORAGE_BUCKET: "marketing-assets",
      }),
    );
    expect(provider.name).toBe("supabase");
    expect(provider.location).toContain("marketing-assets");
  });

  it("puts the local root somewhere a directory can actually be made", async () => {
    const directory = path.join(root, "nested", "deeper");
    await mkdir(directory, { recursive: true });
    const provider = new LocalStorageProvider(directory);
    await provider.put(
      "photos/2026/09/" + "d".repeat(64) + ".png",
      new Uint8Array([1]),
    );
    expect(
      await provider.head("photos/2026/09/" + "d".repeat(64) + ".png"),
    ).not.toBeNull();
  });
});

describe("HTTP ranges", () => {
  it("reads the forms a browser sends", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=2000-3000", 1000)).toBeNull();
    expect(parseRange("bytes=0-99, 200-299", 1000)).toBeNull();
    expect(parseRange(null, 1000)).toBeNull();
  });
});
