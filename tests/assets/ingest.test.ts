/**
 * Upload, browse, edit, delete — against the real schema and real files on
 * disk, with no cloud account anywhere in the picture.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteAsset, ingestFile, ingestFiles } from "@/lib/assets/ingest";
import { MAX_FILES_PER_UPLOAD } from "@/lib/assets/formats";
import {
  exifWithGps,
  htmlNamedJpeg,
  jpegWithGps,
  pngNamedJpg,
  quicktimeWithLocation,
  repoFile,
} from "./support/fixtures";
import { createAssetWorld, type AssetTestWorld } from "./support/db";

let world: AssetTestWorld;

beforeAll(async () => {
  world = await createAssetWorld();
}, 120_000);

afterAll(async () => {
  await world.close();
});

function ports() {
  return {
    store: world.store,
    storage: world.storage,
    drafter: null,
    operatorId: world.operatorId,
    now: () => new Date("2026-09-14T22:15:00Z"),
  };
}

describe("uploading a photo off a phone", () => {
  it("stores it, scrubbed, described and linked to the bottles in it", async () => {
    const outcome = await ingestFile(
      { bytes: jpegWithGps(), filename: "IMG_4821.JPG", declaredMimeType: "image/jpeg" },
      {
        title: "Stall on the corner",
        description: "The stall at the Sunday market, four bottles on the table.",
        occasion: "Grey Lynn market",
        occasionOn: "2026-09-14",
        tags: "market, stall, spring",
        peoplePresent: false,
        variantIds: [world.variants[0]?.variantId ?? ""],
      },
      ports(),
    );

    expect(outcome.status).toBe("stored");
    if (outcome.status !== "stored") return;
    const asset = outcome.asset;

    expect(asset.title).toBe("Stall on the corner");
    expect(asset.description).toContain("Sunday market");
    expect(asset.descriptionSource).toBe("founder");
    expect(asset.occasion).toBe("Grey Lynn market");
    expect(asset.occasionOn).toBe("2026-09-14");
    expect(asset.tags).toEqual(["market", "stall", "spring"]);
    expect(asset.products.map((product) => product.sku)).toEqual(["HS-01-500"]);
    expect(asset.width).toBe(1024);
    expect(asset.height).toBe(1280);
    expect(asset.aspectRatio).toBeCloseTo(0.8, 3);
    expect(asset.kind).toBe("photo");

    // Consent: no people, so it is usable, and the database says so itself.
    expect(asset.peopleConsent).toBe("no_people");
    expect(asset.selectableForOutbound).toBe(true);

    // The location was in the file, was taken out, and was never written down.
    expect(asset.hadLocationMetadata).toBe(true);
    expect(asset.metadataStripped).toBe(true);
    expect(asset.capturedAt).toBe("2026-09-14T10:31:08.000Z");
    expect(outcome.notes.join(" ")).toContain("coordinates");

    // And the bytes on disk are the scrubbed bytes, not the ones uploaded.
    const stored = await readFile(path.join(world.directory, asset.storageKey));
    expect(stored.length).toBe(asset.byteSize);
    expect(stored.length).toBeLessThan(jpegWithGps().length);
    expect(stored.includes(Buffer.from(exifWithGps()))).toBe(false);
    expect(asset.storageKey.endsWith(`${asset.checksum}.jpg`)).toBe(true);
    expect(asset.storageBackend).toBe("local");
  });

  it("deduplicates on the checksum of the stored bytes", async () => {
    const again = await ingestFile(
      { bytes: jpegWithGps(), filename: "another-name.jpg" },
      { title: "A different title entirely" },
      ports(),
    );
    expect(again.status).toBe("duplicate");
    if (again.status !== "duplicate") return;
    expect(again.asset.title).toBe("Stall on the corner");
    expect(again.notes.join(" ")).toContain("already in the library");
    expect(await world.store.count()).toBe(1);
  });

  it("defaults consent to the state nothing can use when there are people in it", async () => {
    const outcome = await ingestFile(
      { bytes: repoFile("public/media/bottles/no-02-dirty.jpg"), filename: "market.jpg" },
      {
        title: "Two customers at the stall",
        description: "Two people at the stall, holding a bottle each.",
        peoplePresent: true,
      },
      ports(),
    );
    expect(outcome.status).toBe("stored");
    if (outcome.status !== "stored") return;
    expect(outcome.asset.peopleConsent).toBe("unrecorded");
    expect(outcome.asset.selectableForOutbound).toBe(false);
    expect(outcome.notes.join(" ")).toContain("record whether they agreed");
  });

  it("writes an honest default description when she does not write one", async () => {
    const outcome = await ingestFile(
      { bytes: repoFile("public/media/bottles/no-03-smoke.jpg"), filename: "IMG_5000.jpg" },
      { occasion: "the kitchen bench" },
      ports(),
    );
    expect(outcome.status).toBe("stored");
    if (outcome.status !== "stored") return;
    expect(outcome.asset.description).toContain("kitchen bench");
    expect(outcome.asset.description).toContain("Nobody has written down");
    expect(outcome.asset.title).toBe("IMG 5000");
  });
});

describe("uploading a video", () => {
  it("stores it with the poster frame the browser captured", async () => {
    const outcome = await ingestFile(
      {
        bytes: repoFile("public/media/film/no-01-house.mp4"),
        filename: "bottling.mp4",
      },
      {
        title: "Bottling line, batch E",
        description: "Bottles moving along the bench as they are filled.",
        poster: {
          bytes: repoFile("public/media/film/no-01-house-poster.jpg"),
          filename: "poster.jpg",
        },
      },
      ports(),
    );
    expect(outcome.status).toBe("stored");
    if (outcome.status !== "stored") return;
    expect(outcome.asset.kind).toBe("video");
    expect(outcome.asset.durationMs).toBe(6000);
    expect(outcome.asset.posterStorageKey).not.toBeNull();
    expect(outcome.asset.posterStorageKey ?? "").toContain("posters/");
    const poster = await world.storage.bytes(outcome.asset.posterStorageKey ?? "");
    expect(poster?.length).toBeGreaterThan(1000);
  });

  it("says so plainly when no poster frame came with it", async () => {
    const outcome = await ingestFile(
      { bytes: quicktimeWithLocation(), filename: "clip.mov" },
      { title: "Phone clip", description: "A clip off the phone." },
      ports(),
    );
    expect(outcome.status).toBe("stored");
    if (outcome.status !== "stored") return;
    expect(outcome.asset.posterStorageKey).toBeNull();
    expect(outcome.asset.hadLocationMetadata).toBe(true);
    expect(outcome.notes.join(" ")).toContain("No poster frame");
  });
});

describe("what does not get in", () => {
  it("rejects a mislabelled file and writes nothing anywhere", async () => {
    const before = await world.store.count();
    const { bytes, filename } = pngNamedJpg();
    const outcome = await ingestFile(
      { bytes, filename, declaredMimeType: "image/jpeg" },
      { title: "Sneaky" },
      ports(),
    );
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") return;
    expect(outcome.code).toBe("content_type_mismatch");
    expect(await world.store.count()).toBe(before);
  });

  it("rejects an HTML page dressed as a photo", async () => {
    const { bytes, filename } = htmlNamedJpeg();
    const outcome = await ingestFile(
      { bytes, filename, declaredMimeType: "image/jpeg" },
      {},
      ports(),
    );
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") return;
    expect(outcome.code).toBe("unsupported_format");
  });

  it("refuses an upload with more files than the cap", async () => {
    const many = Array.from({ length: MAX_FILES_PER_UPLOAD + 1 }, (_, index) => ({
      bytes: jpegWithGps(),
      filename: `photo-${String(index)}.jpg`,
    }));
    await expect(ingestFiles(many, {}, ports())).rejects.toThrow(/at most/i);
  });
});

describe("editing and deleting", () => {
  it("records a consent decision with the time it was made", async () => {
    const [withPeople] = await world.store.list({ consent: "unrecorded" });
    expect(withPeople).toBeDefined();
    if (withPeople === undefined) return;

    const updated = await world.store.update(withPeople.id, {
      peopleConsent: "granted",
      consentNote: "Asked them at the stall; both happy to be in a post.",
      operatorId: world.operatorId,
    });
    expect(updated.peopleConsent).toBe("granted");
    expect(updated.consentRecordedAt).not.toBeNull();
    expect(updated.selectableForOutbound).toBe(true);

    const refused = await world.store.update(withPeople.id, {
      peopleConsent: "refused",
      consentNote: "One of them changed her mind.",
      operatorId: world.operatorId,
    });
    expect(refused.selectableForOutbound).toBe(false);
  });

  it("keeps the two people columns consistent, whichever one she moves", async () => {
    const [asset] = await world.store.list({ limit: 1 });
    expect(asset).toBeDefined();
    if (asset === undefined) return;
    const off = await world.store.update(asset.id, { peoplePresent: false });
    expect(off.peopleConsent).toBe("no_people");
    const on = await world.store.update(asset.id, { peoplePresent: true });
    expect(on.peopleConsent).toBe("unrecorded");
    expect(on.selectableForOutbound).toBe(false);
    await world.store.update(asset.id, { peoplePresent: false });
  });

  it("cannot be talked into writing the gate column directly", async () => {
    await expect(
      world.sql.query(
        `update public.marketing_assets set selectable_for_outbound = true`,
      ),
    ).rejects.toThrow(/can only be updated to DEFAULT/i);
  });

  it("deletes the row and the bytes together", async () => {
    const [asset] = await world.store.list({ limit: 1 });
    expect(asset).toBeDefined();
    if (asset === undefined) return;
    const before = await world.store.count();
    const removed = await deleteAsset(asset.id, {
      store: world.store,
      storage: world.storage,
    });
    expect(removed?.id).toBe(asset.id);
    expect(await world.store.count()).toBe(before - 1);
    expect(await world.storage.head(asset.storageKey)).toBeNull();
    expect(await world.store.get(asset.id)).toBeNull();
  });
});

describe("the library's own summary", () => {
  it("counts what she needs to act on", async () => {
    const summary = await world.store.summary();
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.photos + summary.videos).toBe(summary.total);
    expect(summary.locationsRemoved).toBeGreaterThan(0);
    expect(summary.byteSize).toBeGreaterThan(0);
  });
});
