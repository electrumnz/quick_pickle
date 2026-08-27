/**
 * Base64url and hex helpers.
 *
 * Written against `atob`/`btoa` and typed arrays rather than `Buffer` so that
 * the sealing code runs unchanged in the Node runtime, the Edge runtime and
 * under vitest. No dependency, no runtime branch.
 */

const BASE64URL_TO_BASE64 = /[-_]/g;
const BASE64_TO_BASE64URL = /[+/]/g;

/** Encode bytes as unpadded base64url. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(BASE64_TO_BASE64URL, (character) =>
      character === "+" ? "-" : "_",
    )
    .replace(/=+$/, "");
}

/** Decode unpadded base64url back to bytes. Throws on malformed input. */
export function fromBase64Url(value: string): Uint8Array {
  const normalised = value.replace(BASE64URL_TO_BASE64, (character) =>
    character === "-" ? "+" : "/",
  );
  const padded = normalised.padEnd(
    normalised.length + ((4 - (normalised.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

const HEX_ALPHABET = "0123456789abcdef";

/** Lowercase hex encoding, used for the SHA-256 session token digest. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += HEX_ALPHABET[byte >> 4] ?? "";
    out += HEX_ALPHABET[byte & 0x0f] ?? "";
  }
  return out;
}

/** Decode lowercase or uppercase hex. Throws on malformed input. */
export function fromHex(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(value)) {
    throw new Error("Malformed hex input");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
