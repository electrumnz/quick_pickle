/**
 * Proving that a request to an inbound endpoint is from who it says.
 *
 * Two schemes, both checked before a single byte of the body is parsed:
 *
 *   bearer  `Authorization: Bearer <secret>`, for the raw-email endpoint a
 *           Cloudflare Email Worker or any forwarder posts to.
 *   Svix    the signature Resend puts on its webhooks: an HMAC-SHA256 over
 *           `${id}.${timestamp}.${body}`, keyed with the base64 part of the
 *           secret after `whsec_`, sent base64 in `svix-signature` as one or
 *           more space-separated `v1,<signature>` values.
 *
 * Every comparison of a secret or a signature takes the same time whether
 * it is wrong in the first character or the last.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Are two secrets the same? Both are hashed first, so the comparison is
 * between two values of the same length and says nothing about either's.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

/** The token from an `Authorization: Bearer …` header, or null. */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header ?? "");
  return match?.[1] ?? null;
}

/** How far a webhook's clock may be from ours, either way. */
export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export type SvixCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /**
       *   unconfigured  our own secret is not a usable Svix secret
       *   missing       a header is absent or malformed
       *   stale         the timestamp is too old, or from the future
       *   mismatch      no signature in the header is right
       */
      readonly reason: "unconfigured" | "missing" | "stale" | "mismatch";
    };

/** The signing key inside a `whsec_…` secret, or null if it is not one. */
function svixKey(secret: string): Buffer | null {
  const trimmed = secret.trim();
  const encoded = trimmed.startsWith("whsec_") ? trimmed.slice(6) : trimmed;
  if (!/^[A-Za-z0-9+/]{16,}={0,2}$/.test(encoded)) return null;
  const key = Buffer.from(encoded, "base64");
  return key.length >= 12 ? key : null;
}

/**
 * Check a Svix signature. `body` is the request body exactly as it arrived:
 * the signature is over those bytes, so it must be checked before anything
 * reads them as JSON.
 */
export function verifySvixSignature(input: {
  readonly secret: string;
  readonly id: string | null;
  readonly timestamp: string | null;
  readonly signature: string | null;
  readonly body: Uint8Array;
  readonly now: Date;
  readonly toleranceSeconds?: number;
}): SvixCheck {
  const key = svixKey(input.secret);
  if (key === null) return { ok: false, reason: "unconfigured" };

  const id = input.id?.trim() ?? "";
  const timestamp = input.timestamp?.trim() ?? "";
  const signature = input.signature?.trim() ?? "";
  if (
    !/^[\w.:-]{1,200}$/.test(id) ||
    !/^\d{1,12}$/.test(timestamp) ||
    signature === "" ||
    signature.length > 2000
  ) {
    return { ok: false, reason: "missing" };
  }

  const tolerance = input.toleranceSeconds ?? SVIX_TOLERANCE_SECONDS;
  const drift = Math.abs(input.now.getTime() / 1000 - Number(timestamp));
  if (drift > tolerance) return { ok: false, reason: "stale" };

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.`, "utf8")
    .update(input.body)
    .digest();

  // Every candidate is compared, so the time taken does not say which one,
  // if any, was right.
  let matched = false;
  for (const candidate of signature.split(/\s+/).slice(0, 10)) {
    const comma = candidate.indexOf(",");
    if (comma < 1 || candidate.slice(0, comma) !== "v1") continue;
    const given = Buffer.from(candidate.slice(comma + 1), "base64");
    if (given.length !== expected.length) continue;
    if (timingSafeEqual(given, expected)) matched = true;
  }
  return matched ? { ok: true } : { ok: false, reason: "mismatch" };
}
