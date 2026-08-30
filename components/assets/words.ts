/**
 * How the library says things out loud.
 *
 * One file, so the same asset is described in the same words on the card, on
 * the detail page and in the approval — and so no screen invents a phrase for a
 * consent state that means something slightly different from the one next to
 * it.
 *
 * New Zealand time throughout, like the rest of the admin: her day, not the
 * server's.
 */

import type { AssetKind, ConsentState, MarketingAsset } from "@/lib/assets";

export const NZ_TIME_ZONE = "Pacific/Auckland";

const DAY = new Intl.DateTimeFormat("en-NZ", {
  timeZone: NZ_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** `2026-09-14` or an ISO timestamp, as "14 Sep 2026". */
export function day(value: string | null): string {
  if (value === null || value === "") return "no date";
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(parsed.getTime()) ? "no date" : DAY.format(parsed);
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toString()} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function seconds(durationMs: number | null): string | null {
  if (durationMs === null) return null;
  const total = Math.round(durationMs / 1000);
  if (total < 60) return `${String(total)} seconds`;
  const minutes = Math.floor(total / 60);
  return `${String(minutes)} min ${String(total % 60)} s`;
}

export function kindWord(kind: AssetKind): string {
  return kind === "photo" ? "Photo" : "Video";
}

/** The badge on a card. Short, and never the only carrier of the meaning. */
export function consentBadge(state: ConsentState): {
  readonly label: string;
  readonly tone: "neutral" | "quiet" | "accent" | "danger";
} {
  switch (state) {
    case "no_people":
      return { label: "No people in it", tone: "quiet" };
    case "granted":
      return { label: "They agreed", tone: "accent" };
    case "refused":
      return { label: "They said no", tone: "danger" };
    case "unrecorded":
      return { label: "Consent not recorded", tone: "danger" };
  }
}

/** The one line under a card: where, when, what is in it. */
export function context(asset: MarketingAsset): string {
  const parts: string[] = [];
  if (asset.occasion !== null) parts.push(asset.occasion);
  const when = asset.occasionOn ?? asset.capturedAt;
  if (when !== null) parts.push(day(when));
  if (asset.products.length > 0) {
    parts.push(asset.products.map((product) => product.sku).join(", "));
  }
  return parts.join(" · ");
}

/** Where the bytes are served from. Behind the admin session, always. */
export function fileHref(key: string): string {
  return `/admin/assets/file/${key}`;
}

export function assetHref(id: string): string {
  return `/admin/assets/${id}`;
}

/** The shape, in the words a person uses about a post. */
export function shapeWords(asset: MarketingAsset): string {
  if (asset.aspectRatio === null) return "shape not known";
  if (asset.aspectRatio > 1.05) return "landscape";
  if (asset.aspectRatio < 0.95) return "upright";
  return "square";
}
