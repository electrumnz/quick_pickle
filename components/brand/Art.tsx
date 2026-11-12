import manifest from "@/lib/brand/art/manifest.json";

/**
 * A piece of raster brand art, pre-sized by scripts/build-art.mjs.
 *
 * A plain <img> on purpose. Every file under public/brand is already a
 * near-lossless WebP at exactly the widths this component asks for, so
 * next/image has nothing left to do but re-encode good art into worse art on
 * first request. Width and height are always set, which is what keeps the
 * layout from shifting while it loads.
 */

export type ArtName = keyof typeof manifest;

type Props = {
  readonly name: ArtName;
  /** Empty string for art that is decoration next to text saying the same. */
  readonly alt: string;
  /** The usual `sizes` hint: how wide this is drawn at each breakpoint. */
  readonly sizes: string;
  readonly className?: string;
  /** Above the fold: load now, at high priority. */
  readonly eager?: boolean;
};

export function Art({ name, alt, sizes, className, eager = false }: Props) {
  const entry = manifest[name];
  const srcSet = entry.sources
    .map((source) => `/brand/${source.file} ${String(source.width)}w`)
    .join(", ");
  const fallback =
    entry.sources[Math.min(1, entry.sources.length - 1)] ?? entry.sources[0]!;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-optimised static art; see the note above
    <img
      src={`/brand/${fallback.file}`}
      srcSet={srcSet}
      sizes={sizes}
      width={entry.width}
      height={entry.height}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      decoding="async"
      draggable={false}
      className={className}
    />
  );
}
