import "server-only";

import { createHash } from "node:crypto";

/**
 * Upload, end to end.
 *
 * The order of these steps is the security design, so it is written out here
 * rather than left to be reconstructed from the code:
 *
 *  1. **Sniff.** `formats.ts` decides what the file is from its bytes. The name
 *     and the browser's claimed type are used only to write a better error.
 *  2. **Compare the claim.** A `.jpg` whose bytes are a PNG is refused rather
 *     than quietly accepted, because a file that lies about itself is the shape
 *     an attack takes even when this particular one is a rename.
 *  3. **Check the size**, against a per-kind cap.
 *  4. **Scrub.** `scrub.ts` walks the container, drops the metadata and rebuilds
 *     the file. A file that does not parse dies here, before anything is
 *     written anywhere. The bytes that continue are not the bytes that arrived.
 *  5. **Hash what will be stored**, not what arrived, so the same photo from two
 *     phones deduplicates to one row.
 *  6. **Deduplicate** against the database before touching storage.
 *  7. **Store the bytes** under a content-addressed key.
 *  8. **Describe** — her words, or a labelled model draft, or an honest default.
 *  9. **Write the row**, with consent defaulting to the unusable state.
 *
 * Nothing is written to storage before step 4 has succeeded, and the row is
 * written last, so a rejected file leaves nothing behind.
 */

import { assertSelectableForOutbound } from "./consent";
import type { DescriptionDrafter } from "./describe";
import { AssetError, isAssetError } from "./errors";
import {
  assertClaimMatches,
  assertSize,
  sniff,
  MAX_FILES_PER_UPLOAD,
  MAX_POSTER_BYTES,
  MAX_UPLOAD_BYTES,
  megabytes,
} from "./formats";
import {
  assetSlug,
  cleanTags,
  defaultDescription,
  defaultTitle,
} from "./naming";
import { scrub } from "./scrub";
import { assetObjectKey, type StorageProvider } from "./storage/provider";
import type { AssetStore } from "./store/types";
import type { ConsentState, MarketingAsset, UsageRights } from "./types";

export interface UploadedFile {
  readonly bytes: Uint8Array;
  readonly filename: string;
  /** What the browser said it was. Never trusted, only quoted back. */
  readonly declaredMimeType?: string | null;
  /**
   * The still the browser captured for this clip, when there is one. It is a
   * file like any other and is sniffed, capped and scrubbed like any other.
   */
  readonly poster?: UploadedFile | null;
}

/** What the founder filled in beside the file. Every field is optional. */
export interface AssetIntake {
  readonly title?: string;
  readonly description?: string;
  readonly occasion?: string;
  /** `YYYY-MM-DD`. Defaults to the day the camera says the shutter fired. */
  readonly occasionOn?: string;
  readonly tags?: string | readonly string[];
  readonly peoplePresent?: boolean;
  readonly peopleConsent?: ConsentState;
  readonly consentNote?: string;
  readonly usageRights?: UsageRights;
  readonly credit?: string;
  readonly rightsExpireOn?: string;
  readonly variantIds?: readonly string[];
  /** A poster frame the browser captured for a video. Validated like any file. */
  readonly poster?: UploadedFile | null;
  /** Length in milliseconds, when the container does not carry it (WebM). */
  readonly durationMs?: number | null;
}

export interface IngestPorts {
  readonly store: AssetStore;
  readonly storage: StorageProvider;
  readonly drafter?: DescriptionDrafter | null;
  readonly now?: () => Date;
  readonly operatorId?: string | null;
}

export type IngestOutcome =
  | {
      readonly status: "stored";
      readonly asset: MarketingAsset;
      readonly notes: readonly string[];
    }
  | {
      readonly status: "duplicate";
      readonly asset: MarketingAsset;
      readonly notes: readonly string[];
    }
  | {
      readonly status: "rejected";
      readonly filename: string;
      readonly code: string;
      readonly message: string;
    };

export async function ingestFile(
  file: UploadedFile,
  intake: AssetIntake,
  ports: IngestPorts,
): Promise<IngestOutcome> {
  const now = ports.now?.() ?? new Date();
  try {
    const { format } = sniff(file.bytes);
    assertClaimMatches(format, {
      filename: file.filename,
      mimeType: file.declaredMimeType ?? undefined,
    });
    assertSize(file.bytes, format);

    const scrubbed = scrub(file.bytes, format);
    const checksum = sha256(scrubbed.bytes);

    const existing = await ports.store.byChecksum(checksum);
    if (existing !== null) {
      return {
        status: "duplicate",
        asset: existing,
        notes: [
          `That is the same file as "${existing.title}", which is already in the library. Nothing was added.`,
        ],
      };
    }

    const notes: string[] = [];
    if (scrubbed.removed.length > 0) {
      notes.push(`Removed from the file: ${scrubbed.removed.join(", ")}.`);
    }
    if (scrubbed.hadLocation) {
      notes.push(
        "It carried the coordinates of where it was taken. Those are gone, and were never written down.",
      );
    }
    if (!scrubbed.stripped) {
      notes.push(
        "WebM is stored as uploaded — this library does not rewrite that container.",
      );
    }

    // The poster frame is an uploaded file too, and gets the same treatment.
    let posterKey: string | null = null;
    let posterBytes: Uint8Array | null = null;
    const supplied = file.poster ?? intake.poster ?? null;
    if (format.kind === "video" && supplied !== null) {
      const poster = preparePoster(supplied);
      if (poster === null) {
        notes.push(
          "The poster frame the browser captured was not a picture we accept, so it was dropped.",
        );
      } else {
        posterBytes = poster.bytes;
        posterKey = assetObjectKey({
          checksum: poster.checksum,
          extension: poster.extension,
          at: now,
          prefix: "posters",
        });
        await ports.storage.put(posterKey, poster.bytes);
      }
    }
    if (format.kind === "video" && posterKey === null) {
      notes.push(
        "No poster frame was captured, so this clip shows as a plain card until one is.",
      );
    }

    const key = assetObjectKey({
      checksum,
      extension: format.extension,
      at: now,
      prefix: format.kind === "photo" ? "photos" : "video",
    });
    await ports.storage.put(key, scrubbed.bytes);

    const title =
      clean(intake.title) ?? defaultTitle(file.filename, format.kind);
    const occasion = clean(intake.occasion) ?? null;
    const takenAt = scrubbed.capturedAt;

    const described = await describe({
      intake,
      drafter: ports.drafter ?? null,
      bytes: format.kind === "photo" ? scrubbed.bytes : posterBytes,
      mimeType: format.kind === "photo" ? format.mime : "image/jpeg",
      occasion,
      kind: format.kind,
      filename: file.filename,
      takenAt,
      notes,
    });

    const peoplePresent = intake.peoplePresent === true;
    const consent = resolveConsent(peoplePresent, intake.peopleConsent);
    const consentDecided = consent === "granted" || consent === "refused";

    const asset = await ports.store.create({
      slug: assetSlug({ title, filename: file.filename, checksum }),
      kind: format.kind,
      title,
      description: described.text,
      descriptionSource: described.source,
      descriptionModel: described.model,
      occasion,
      occasionOn: clean(intake.occasionOn) ?? dayOf(takenAt),
      capturedAt: takenAt,
      peoplePresent,
      peopleConsent: consent,
      consentNote: clean(intake.consentNote) ?? null,
      consentRecordedAt: consentDecided ? now.toISOString() : null,
      consentRecordedBy: consentDecided ? (ports.operatorId ?? null) : null,
      usageRights: intake.usageRights ?? "own_work",
      credit: clean(intake.credit) ?? null,
      rightsExpireOn: clean(intake.rightsExpireOn) ?? null,
      tags: cleanTags(intake.tags ?? []),
      storageBackend: ports.storage.name,
      storageKey: key,
      posterStorageKey: posterKey,
      mimeType: format.mime,
      byteSize: scrubbed.bytes.length,
      checksum,
      originalFilename: file.filename.slice(0, 200),
      width: scrubbed.width,
      height: scrubbed.height,
      durationMs: scrubbed.durationMs ?? positive(intake.durationMs),
      metadataStripped: scrubbed.stripped,
      hadLocationMetadata: scrubbed.hadLocation,
      uploadedBy: ports.operatorId ?? null,
      variantIds: intake.variantIds ?? [],
    });

    if (peoplePresent && consent === "unrecorded") {
      notes.push(
        "There are people in this one, so no agent can choose it until you record whether they agreed.",
      );
    }

    return { status: "stored", asset, notes };
  } catch (cause) {
    if (isAssetError(cause)) {
      return {
        status: "rejected",
        filename: file.filename,
        code: cause.code,
        message: cause.message,
      };
    }
    throw cause;
  }
}

/**
 * A whole upload: several files, one set of shared answers.
 *
 * The caps are checked before any file is looked at, so a 3 GB drop is refused
 * in one sentence instead of after two minutes of work.
 */
export async function ingestFiles(
  files: readonly UploadedFile[],
  intake: AssetIntake,
  ports: IngestPorts,
): Promise<readonly IngestOutcome[]> {
  if (files.length === 0) {
    throw new AssetError("invalid_metadata", "No files were chosen.");
  }
  if (files.length > MAX_FILES_PER_UPLOAD) {
    throw new AssetError(
      "too_many_files",
      `That is ${String(files.length)} files, and an upload takes at most ${String(MAX_FILES_PER_UPLOAD)} at a time.`,
    );
  }
  const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (total > MAX_UPLOAD_BYTES) {
    throw new AssetError(
      "upload_too_large",
      `That is ${megabytes(total)} altogether, and an upload takes at most ${megabytes(MAX_UPLOAD_BYTES)}.`,
    );
  }

  const outcomes: IngestOutcome[] = [];
  for (const file of files) {
    outcomes.push(await ingestFile(file, intake, ports));
  }
  return outcomes;
}

/**
 * Delete an asset and its bytes.
 *
 * The row goes first: if the object store then fails, the library is honest
 * about what it holds and the orphaned bytes are unreachable, which is the safe
 * way round. The reverse order would leave a row pointing at nothing.
 */
export async function deleteAsset(
  id: string,
  ports: Pick<IngestPorts, "store" | "storage">,
): Promise<MarketingAsset | null> {
  const removed = await ports.store.remove(id);
  if (removed === null) return null;
  await ports.storage.remove(removed.storageKey).catch(() => undefined);
  if (removed.posterStorageKey !== null) {
    await ports.storage.remove(removed.posterStorageKey).catch(() => undefined);
  }
  return removed;
}

/** Re-export so a caller cannot reach for a different consent check. */
export { assertSelectableForOutbound };

// ---------------------------------------------------------------------------

interface PreparedPoster {
  readonly bytes: Uint8Array;
  readonly checksum: string;
  readonly extension: string;
}

function preparePoster(poster: UploadedFile): PreparedPoster | null {
  try {
    if (poster.bytes.length > MAX_POSTER_BYTES) return null;
    const { format } = sniff(poster.bytes);
    if (format.kind !== "photo") return null;
    const scrubbed = scrub(poster.bytes, format);
    return {
      bytes: scrubbed.bytes,
      checksum: sha256(scrubbed.bytes),
      extension: format.extension,
    };
  } catch {
    return null;
  }
}

interface Described {
  readonly text: string;
  readonly source: "founder" | "model_draft";
  readonly model: string | null;
}

async function describe(input: {
  readonly intake: AssetIntake;
  readonly drafter: DescriptionDrafter | null;
  readonly bytes: Uint8Array | null;
  readonly mimeType: string;
  readonly occasion: string | null;
  readonly kind: "photo" | "video";
  readonly filename: string;
  readonly takenAt: string | null;
  readonly notes: string[];
}): Promise<Described> {
  const hers = clean(input.intake.description);
  if (hers !== null) {
    return { text: hers, source: "founder", model: null };
  }
  if (input.drafter !== null && input.bytes !== null) {
    const draft = await input.drafter.draft({
      bytes: input.bytes,
      mimeType: input.mimeType,
      hint: input.occasion,
    });
    if (draft !== null) {
      input.notes.push(
        "The description is a first draft written by a vision model. Correct it — an agent will use these words.",
      );
      return { text: draft.text, source: "model_draft", model: draft.model };
    }
    input.notes.push(
      "No description was drafted for this one, so it has the plain default. Write a line and it becomes useful.",
    );
  }
  return {
    text: defaultDescription({
      kind: input.kind,
      filename: input.filename,
      occasion: input.occasion,
      takenAt: input.takenAt,
    }),
    source: "founder",
    model: null,
  };
}

/**
 * Consent defaults to the state that cannot be used.
 *
 * "There are people in it and I have not asked them" is the honest default for
 * a photo taken at a market, and the whole gate rests on that default being
 * unusable rather than convenient.
 */
function resolveConsent(
  peoplePresent: boolean,
  given: ConsentState | undefined,
): ConsentState {
  if (!peoplePresent) return "no_people";
  if (given === "granted" || given === "refused") return given;
  return "unrecorded";
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function clean(value: string | undefined | null): string | null {
  const text = value?.trim();
  return text === undefined || text === "" ? null : text;
}

function dayOf(iso: string | null): string | null {
  if (iso === null) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
}

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}
