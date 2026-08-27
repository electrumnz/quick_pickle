import { type Bytes, toBase64Url, toHex } from "./encoding";

/**
 * Cryptographically secure randomness.
 *
 * `crypto.getRandomValues` is the one CSPRNG available identically in the Node
 * runtime, the Edge runtime and the browser. `Math.random` appears nowhere in
 * this package.
 */
export function randomBytes(length: number): Bytes {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** 256 bits of entropy as base64url. Used for session and CSRF tokens. */
export function randomToken(byteLength = 32): string {
  return toBase64Url(randomBytes(byteLength));
}

/** A short opaque id for correlating one request across audit rows and logs. */
export function randomRequestId(): string {
  return toHex(randomBytes(8));
}

/** SHA-256 of a UTF-8 string, lowercase hex. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return toHex(new Uint8Array(digest));
}
