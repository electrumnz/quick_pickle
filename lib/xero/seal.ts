/**
 * Sealing the two keys Xero hands over, before they are kept.
 *
 * A key that renews itself has to be kept as it is: a hash of it would be
 * no use. So each is sealed (AES-256-GCM) with a key made from the Xero
 * app's own secret (`XERO_CLIENT_SECRET`), which lives on the host and not
 * in the database. A copy of the database alone opens nothing, and nor does
 * the secret alone. Give the app a new secret and what is kept no longer
 * opens: the owner connects Xero again.
 */

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";

function keyFrom(secret: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", secret, "quick-pickle", "xero tokens v1", 32),
  );
}

export function seal(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    body.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

/** The value, or null if it was not sealed with this secret. */
export function unseal(sealed: string, secret: string): string | null {
  const [version, iv, body, tag] = sealed.split(".");
  if (version !== VERSION || !iv || !body || !tag) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFrom(secret),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
