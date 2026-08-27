import { timingSafeEqualStrings } from "./constant-time";
import { type Bytes, fromBase64Url, toBase64Url } from "./encoding";
import { randomBytes } from "./random";

/**
 * Sealed cookie payloads: AES-256-GCM under a purpose-scoped key.
 *
 * Encrypted rather than merely signed, because the requirement is that the
 * cookie's *contents* cannot be read client-side, not only that they cannot be
 * forged. A signed-but-plaintext cookie would tell anyone with devtools the
 * session row id and the expiry; this tells them nothing but a length.
 *
 * Forgery resistance comes from the GCM authentication tag: any edit to the
 * ciphertext, the IV or the version prefix makes `decrypt` throw, and
 * {@link unseal} turns that into `null` rather than a partially trusted object.
 *
 * The key is HKDF-derived per purpose, so the login CSRF cookie and the session
 * cookie are sealed under different keys and neither can be replayed as the
 * other even before the purpose check below runs. Rotating
 * `ADMIN_SESSION_SECRET` invalidates every outstanding cookie at once, which is
 * the blunt emergency lever that sits behind per-session revocation.
 */

const SEAL_VERSION = "v1";
const HKDF_SALT = new TextEncoder().encode("half-sour/admin-auth/v1");
const IV_BYTES = 12;

/** Distinguishes the two kinds of sealed cookie this package issues. */
export type SealPurpose = "session" | "login-csrf";

type Envelope = {
  readonly p: SealPurpose;
  readonly exp: number;
  readonly d: unknown;
};

async function deriveKey(
  secret: Bytes,
  purpose: SealPurpose,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HKDF_SALT,
      info: new TextEncoder().encode(`seal:${purpose}`),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Seal `payload` into an opaque cookie value valid until `expiresAt`.
 *
 * The purpose is bound twice: as the HKDF `info` that picks the key, and as the
 * GCM additional authenticated data. Either alone would be sufficient; both
 * cost nothing.
 */
export async function seal(
  secret: Bytes,
  purpose: SealPurpose,
  payload: unknown,
  expiresAt: Date,
): Promise<string> {
  const key = await deriveKey(secret, purpose);
  const iv = randomBytes(IV_BYTES);
  const envelope: Envelope = {
    p: purpose,
    exp: expiresAt.getTime(),
    d: payload,
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(envelope));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(`${SEAL_VERSION}:${purpose}`),
      },
      key,
      plaintext,
    ),
  );
  return `${SEAL_VERSION}.${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
}

/**
 * Open a sealed cookie value.
 *
 * Returns `null` — never throws, never partially trusts — when the value is
 * absent, truncated, re-versioned, tampered with, sealed for another purpose,
 * sealed under a different secret, expired, or shaped wrongly once decrypted.
 * `parse` is the caller's schema check and runs only after the tag verifies.
 */
export async function unseal<T>(
  secret: Bytes,
  purpose: SealPurpose,
  token: string | undefined | null,
  now: Date,
  parse: (value: unknown) => T | null,
): Promise<T | null> {
  if (token === undefined || token === null || token === "") return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, encodedIv, encodedCiphertext] = parts;
  if (
    version === undefined ||
    encodedIv === undefined ||
    encodedCiphertext === undefined
  ) {
    return null;
  }
  if (!timingSafeEqualStrings(version, SEAL_VERSION)) return null;

  let plaintext: string;
  try {
    const key = await deriveKey(secret, purpose);
    const iv = fromBase64Url(encodedIv);
    if (iv.length !== IV_BYTES) return null;
    const opened = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(`${SEAL_VERSION}:${purpose}`),
      },
      key,
      fromBase64Url(encodedCiphertext),
    );
    plaintext = new TextDecoder().decode(opened);
  } catch {
    // Bad tag, bad base64, wrong key — all the same answer, no detail leaked.
    return null;
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(plaintext);
  } catch {
    return null;
  }

  if (typeof envelope !== "object" || envelope === null) return null;
  const candidate = envelope as Partial<Envelope>;
  if (typeof candidate.p !== "string" || candidate.p !== purpose) return null;
  if (typeof candidate.exp !== "number" || !Number.isFinite(candidate.exp)) {
    return null;
  }
  if (candidate.exp <= now.getTime()) return null;

  return parse(candidate.d);
}
