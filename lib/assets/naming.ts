/**
 * Names, slugs and the sentence that stands in until she writes a better one.
 *
 * The default description is deliberately dull and literally true. It says what
 * the file is, when it was taken and what it was called, and it says out loud
 * that nobody has described it yet — because the alternative, a confident
 * invented sentence, is how an agent ends up posting a photo of the wrong thing
 * with a caption that sounds certain.
 */

import type { AssetKind } from "./types";

const NZ_DATE = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "Pacific/Auckland",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** `Grey Lynn market!.JPG` → `grey-lynn-market`. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * A slug that is unique without being a UUID.
 *
 * The first eight characters of the content hash are appended, so two photos
 * from the same market on the same day do not collide and the slug still reads
 * like something a person wrote.
 */
export function assetSlug(input: {
  readonly title: string;
  readonly filename: string;
  readonly checksum: string;
}): string {
  const stem =
    slugify(input.title) || slugify(input.filename) || "asset";
  return `${stem}-${input.checksum.slice(0, 8)}`;
}

/** `IMG_4821.HEIC` → `IMG 4821`; a name she will recognise on the screen. */
export function defaultTitle(filename: string, kind: AssetKind): string {
  const stem = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  if (stem === "") return kind === "photo" ? "Untitled photo" : "Untitled clip";
  return stem.slice(0, 120);
}

export function defaultDescription(input: {
  readonly kind: AssetKind;
  readonly filename: string;
  readonly occasion: string | null;
  readonly takenAt: string | null;
}): string {
  const noun = input.kind === "photo" ? "Photo" : "Clip";
  const when =
    input.takenAt === null ? null : NZ_DATE.format(new Date(input.takenAt));
  const where = input.occasion === null ? null : input.occasion;
  const parts = [
    where === null ? `${noun} from the camera roll` : `${noun} from ${where}`,
    when === null ? null : `taken ${when}`,
  ].filter((part): part is string => part !== null);
  return `${parts.join(", ")}. Nobody has written down what is in it yet, so an agent will pass it over.`;
}

/** Free-text tags, cleaned: lowercase, deduplicated, no empties, capped. */
export function cleanTags(raw: string | readonly string[]): readonly string[] {
  const parts = Array.isArray(raw)
    ? [...raw]
    : String(raw).split(/[,\n]/);
  const cleaned = parts
    .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, " "))
    .filter((tag) => tag !== "" && tag.length <= 40);
  return [...new Set(cleaned)].slice(0, 24);
}
