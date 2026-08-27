import { describe, expect, it } from "vitest";

import { ARGON2_PARAMS } from "@/lib/auth/config";
import {
  describeArgon2Hash,
  hashPassword,
  parseArgon2Hash,
  verifyPassword,
} from "@/lib/auth/crypto/argon2";
import {
  timingSafeEqualBytes,
  timingSafeEqualStrings,
} from "@/lib/auth/crypto/constant-time";
import {
  fromBase64Url,
  fromHex,
  fromStandardBase64,
  toBase64Url,
  toHex,
} from "@/lib/auth/crypto/encoding";
import { randomBytes, randomToken, sha256Hex } from "@/lib/auth/crypto/random";
import { seal, unseal } from "@/lib/auth/crypto/seal";

const TEST_PASSWORD = "test-only-passphrase-9f3a-not-production";

describe("constant-time comparison", () => {
  it("matches equal inputs and rejects unequal ones", () => {
    expect(timingSafeEqualStrings("abc", "abc")).toBe(true);
    expect(timingSafeEqualStrings("abc", "abd")).toBe(false);
    expect(timingSafeEqualStrings("abc", "ab")).toBe(false);
    expect(timingSafeEqualStrings("", "")).toBe(true);
  });

  it("folds a length difference into the accumulator rather than returning early", () => {
    // Same first byte, different lengths: an implementation that bailed on
    // length would still answer false, but so does this one, and it walks the
    // full span to get there.
    expect(
      timingSafeEqualBytes(new Uint8Array([1]), new Uint8Array([1, 0, 0, 0])),
    ).toBe(false);
    expect(
      timingSafeEqualBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2])),
    ).toBe(true);
  });

  it("is not fooled by a shared prefix", () => {
    const secret = randomToken(32);
    expect(timingSafeEqualStrings(secret, `${secret.slice(0, -1)}X`)).toBe(
      false,
    );
  });
});

describe("encoding", () => {
  it("round-trips base64url without padding", () => {
    for (let length = 0; length < 40; length += 1) {
      const bytes = randomBytes(length);
      const encoded = toBase64Url(bytes);
      expect(encoded).not.toMatch(/[+/=]/);
      expect(Array.from(fromBase64Url(encoded))).toEqual(Array.from(bytes));
    }
  });

  it("round-trips hex", () => {
    const bytes = randomBytes(32);
    expect(Array.from(fromHex(toHex(bytes)))).toEqual(Array.from(bytes));
    expect(() => fromHex("zz")).toThrow();
  });

  it("decodes the standard alphabet argon2 uses", () => {
    expect(Array.from(fromStandardBase64("BwcHBwcHBwcHBwcHBwcHBw"))).toEqual(
      Array.from(new Uint8Array(16).fill(7)),
    );
  });
});

describe("argon2id password hashing", () => {
  it("stores an argon2id PHC string with the OWASP parameters", async () => {
    const encoded = await hashPassword(TEST_PASSWORD);
    expect(encoded.startsWith("$argon2id$v=19$")).toBe(true);

    const parsed = parseArgon2Hash(encoded);
    expect(parsed).not.toBeNull();
    expect(parsed?.memoryKib).toBe(ARGON2_PARAMS.memoryKib);
    expect(parsed?.iterations).toBe(ARGON2_PARAMS.iterations);
    expect(parsed?.parallelism).toBe(ARGON2_PARAMS.parallelism);
    expect(parsed?.salt.length).toBe(ARGON2_PARAMS.saltLengthBytes);
    expect(parsed?.digest.length).toBe(ARGON2_PARAMS.hashLengthBytes);
  });

  it("is memory-hard: at least 19 MiB and two passes", async () => {
    const parsed = parseArgon2Hash(await hashPassword(TEST_PASSWORD));
    expect(parsed?.memoryKib).toBeGreaterThanOrEqual(19456);
    expect(parsed?.iterations).toBeGreaterThanOrEqual(2);
  });

  it("salts every hash separately", async () => {
    const first = parseArgon2Hash(await hashPassword(TEST_PASSWORD));
    const second = parseArgon2Hash(await hashPassword(TEST_PASSWORD));
    expect(toHex(first?.salt ?? new Uint8Array())).not.toBe(
      toHex(second?.salt ?? new Uint8Array()),
    );
  });

  it("verifies the right password and refuses everything else", async () => {
    const encoded = await hashPassword(TEST_PASSWORD);
    expect(await verifyPassword(TEST_PASSWORD, encoded)).toBe(true);
    expect(await verifyPassword(`${TEST_PASSWORD} `, encoded)).toBe(false);
    expect(await verifyPassword(TEST_PASSWORD.toUpperCase(), encoded)).toBe(
      false,
    );
    expect(await verifyPassword("", encoded)).toBe(false);
  });

  it("refuses a hash that is not argon2id, including a bcrypt one", async () => {
    expect(
      await verifyPassword(
        TEST_PASSWORD,
        "$2b$12$K1p9Z1YyH8oQeQ2s0eXk1uJ9m1V5wS0nQ8m6cQx4t2Rr8bB2nQm2y",
      ),
    ).toBe(false);
    expect(
      await verifyPassword(TEST_PASSWORD, "$argon2i$v=19$m=1,t=1,p=1$AA$AA"),
    ).toBe(false);
    expect(await verifyPassword(TEST_PASSWORD, "not-a-hash")).toBe(false);
  });

  it("describes parameters without revealing salt or digest", async () => {
    const encoded = await hashPassword(TEST_PASSWORD);
    const description = describeArgon2Hash(encoded);
    expect(description).toContain("argon2id(m=19456KiB,t=2,p=1");
    expect(description).not.toContain(encoded.split("$")[4] ?? "");
  });
});

describe("sealed cookie values", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const later = new Date("2026-01-01T00:30:00.000Z");
  const parse = (value: unknown) =>
    typeof value === "object" && value !== null
      ? (value as { sid: string })
      : null;

  it("hides its contents and reopens them with the right key", async () => {
    const secret = randomBytes(32);
    const token = await seal(secret, "session", { sid: "abc-123" }, later);
    expect(token).not.toContain("abc-123");
    expect(atobSafe(token)).not.toContain("abc-123");
    expect(await unseal(secret, "session", token, now, parse)).toEqual({
      sid: "abc-123",
    });
  });

  it("refuses a value sealed under a different secret", async () => {
    const token = await seal(randomBytes(32), "session", { sid: "x" }, later);
    expect(
      await unseal(randomBytes(32), "session", token, now, parse),
    ).toBeNull();
  });

  it("refuses a value sealed for a different purpose", async () => {
    const secret = randomBytes(32);
    const token = await seal(secret, "login-csrf", { sid: "x" }, later);
    expect(await unseal(secret, "session", token, now, parse)).toBeNull();
  });

  it("refuses a bit flipped anywhere in the ciphertext or the tag", async () => {
    const secret = randomBytes(32);
    const token = await seal(secret, "session", { sid: "abc-123" }, later);
    const [version, iv, ciphertext] = token.split(".");
    const bytes = fromBase64Url(ciphertext ?? "");

    // Every byte, not a sample: the last 16 are the GCM authentication tag and
    // the rest are the message, and neither may be editable.
    let rejected = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      const mutated = Uint8Array.from(bytes);
      mutated[index] = (mutated[index] ?? 0) ^ 0x01;
      const result = await unseal(
        secret,
        "session",
        `${version}.${iv}.${toBase64Url(mutated)}`,
        now,
        parse,
      );
      if (result === null) rejected += 1;
    }
    expect(rejected).toBe(bytes.length);
  });

  it("refuses a bit flipped anywhere in the nonce", async () => {
    const secret = randomBytes(32);
    const token = await seal(secret, "session", { sid: "abc-123" }, later);
    const [version, iv, ciphertext] = token.split(".");
    const bytes = fromBase64Url(iv ?? "");

    let rejected = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      const mutated = Uint8Array.from(bytes);
      mutated[index] = (mutated[index] ?? 0) ^ 0x01;
      const result = await unseal(
        secret,
        "session",
        `${version}.${toBase64Url(mutated)}.${ciphertext}`,
        now,
        parse,
      );
      if (result === null) rejected += 1;
    }
    expect(rejected).toBe(bytes.length);
  });

  it("refuses truncation, extension and a re-versioned token", async () => {
    const secret = randomBytes(32);
    const token = await seal(secret, "session", { sid: "abc-123" }, later);
    const [version, iv, ciphertext] = token.split(".");
    const bytes = fromBase64Url(ciphertext ?? "");

    const truncated = toBase64Url(bytes.slice(0, bytes.length - 1));
    const extended = toBase64Url(
      Uint8Array.from([...bytes, 0]) as Uint8Array<ArrayBuffer>,
    );

    for (const candidate of [
      `${version}.${iv}.${truncated}`,
      `${version}.${iv}.${extended}`,
      `v2.${iv}.${ciphertext}`,
      `${iv}.${ciphertext}`,
      `${version}.${iv}`,
      `${version}..${ciphertext}`,
      "",
    ]) {
      expect(await unseal(secret, "session", candidate, now, parse)).toBeNull();
    }
    expect(await unseal(secret, "session", undefined, now, parse)).toBeNull();
  });

  it("accepts a re-encoding that decodes to the same bytes, and only that", async () => {
    // A guard against the obvious bad version of the tests above. Base64's
    // final character can carry padding bits that decode to nothing, so
    // "changed a base64 character" is NOT the same claim as "changed a byte".
    // A token whose bytes are unchanged is not a tampered token, and AES-GCM is
    // right to authenticate it.
    const secret = randomBytes(32);
    const token = await seal(secret, "session", { sid: "abc-123" }, later);
    const [version, iv, ciphertext] = token.split(".");
    const reencoded = toBase64Url(fromBase64Url(ciphertext ?? ""));
    expect(
      await unseal(
        secret,
        "session",
        `${version}.${iv}.${reencoded}`,
        now,
        parse,
      ),
    ).toEqual({ sid: "abc-123" });
  });

  it("refuses an expired value even when the seal is intact", async () => {
    const secret = randomBytes(32);
    const token = await seal(secret, "session", { sid: "x" }, later);
    const afterExpiry = new Date(later.getTime() + 1);
    expect(
      await unseal(secret, "session", token, afterExpiry, parse),
    ).toBeNull();
  });
});

describe("session token digests", () => {
  it("hashes tokens with SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

function atobSafe(value: string): string {
  return value
    .split(".")
    .map((part) => {
      try {
        return new TextDecoder().decode(fromBase64Url(part));
      } catch {
        return "";
      }
    })
    .join("");
}
