import { describe, expect, it } from "vitest";

import {
  replyToken,
  readToken,
  replyAddress,
  tokenInAddress,
  tokenKey,
  tokenKeyState,
} from "@/lib/backstage/mail/token";

/**
 * The reply token: what makes a reply address unforgeable. It names the
 * message we sent, so a reply follows that message wherever it is moved.
 */

const KEY = "a-long-enough-secret-for-signing-tokens";
const ID = "msg_7k2m9x4q8b6t3n5h2w4c";

describe("reply tokens", () => {
  it("round trip: a token we made names the message it was made for", () => {
    const token = replyToken(ID, KEY);
    expect(token).toMatch(/^[2-9a-z]{20}-[0-9a-f]{32}$/);
    expect(readToken(token, KEY)).toEqual({
      verified: true,
      messageId: ID,
    });
    // Mail programs change the case of addresses. That must not break it.
    expect(readToken(token.toUpperCase(), KEY)).toEqual({
      verified: true,
      messageId: ID,
    });
    expect(readToken(`  ${token} `, KEY).verified).toBe(true);
  });

  it("is the same every time, and different for every message", () => {
    expect(replyToken(ID, KEY)).toBe(replyToken(ID, KEY));
    expect(replyToken("msg_7k2m9x4q8b6t3n5h2w4d", KEY)).not.toBe(
      replyToken(ID, KEY),
    );
  });

  it("a token for one message cannot be turned into one for another", () => {
    const token = replyToken(ID, KEY);
    const [, mac = ""] = token.split("-");
    // Someone else's id with our hash.
    expect(readToken(`8k2m9x4q8b6t3n5h2w4c-${mac}`, KEY)).toEqual({
      verified: false,
    });
  });

  it("every single changed character of the hash is caught", () => {
    const token = replyToken(ID, KEY);
    const start = token.indexOf("-") + 1;
    for (let at = start; at < token.length; at += 1) {
      const flipped = token[at] === "0" ? "1" : "0";
      const forged = `${token.slice(0, at)}${flipped}${token.slice(at + 1)}`;
      expect(readToken(forged, KEY), String(at)).toEqual({ verified: false });
    }
  });

  it("is not verified with another key, or with none", () => {
    const token = replyToken(ID, KEY);
    expect(readToken(token, "a-different-secret-entirely")).toEqual({
      verified: false,
    });
    expect(readToken(token, null)).toEqual({ verified: false });
  });

  it("anything that is not shaped like a token is not one", () => {
    for (const junk of [
      "",
      "hello",
      ID,
      `${ID}-`,
      "7k2m9x4q8b6t3n5h2w4c",
      "7k2m9x4q8b6t3n5h2w4c-",
      "7k2m9x4q8b6t3n5h2w4c-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
      `${replyToken(ID, KEY)}0`,
      `x${replyToken(ID, KEY)}`,
    ]) {
      expect(readToken(junk, KEY), junk).toEqual({ verified: false });
    }
    expect(() => replyToken("ord_7k2m9x4q8b6t3n5h2w4c", KEY)).toThrow();
  });

  it("lives in the reply address, which fits in an email address", () => {
    const address = replyAddress(ID, "hello@quickpickle.example", KEY);
    expect(address).toBe(`reply+${replyToken(ID, KEY)}@quickpickle.example`);
    // The part before the @ may be 64 characters and no more.
    expect(address.split("@")[0]?.length).toBeLessThanOrEqual(64);
    expect(tokenInAddress(address)).toBe(replyToken(ID, KEY));
    expect(tokenInAddress(address.toUpperCase())).toBe(replyToken(ID, KEY));
    expect(tokenInAddress("hello@quickpickle.example")).toBeNull();
    expect(tokenInAddress("reply@quickpickle.example")).toBeNull();
    expect(tokenInAddress("reply+@quickpickle.example")).toBeNull();
    expect(tokenInAddress("not an address")).toBeNull();
  });

  it("with no key there are no tokens: replies go to the mailbox itself", () => {
    expect(replyAddress(ID, "hello@quickpickle.example", null)).toBe(
      "hello@quickpickle.example",
    );
  });
});

describe("where the key comes from", () => {
  it("is MAIL_TOKEN_SECRET when that is long enough", () => {
    expect(tokenKeyState({ MAIL_TOKEN_SECRET: KEY })).toBe("set");
    expect(tokenKey({ MAIL_TOKEN_SECRET: `  ${KEY}  ` })).toBe(KEY);
  });

  it("is nothing at all outside tests when the secret is missing or short", () => {
    for (const env of [
      {},
      { NODE_ENV: "production" },
      { NODE_ENV: "development", MAIL_TOKEN_SECRET: "" },
      { NODE_ENV: "production", MAIL_TOKEN_SECRET: "short" },
    ]) {
      expect(tokenKey(env), JSON.stringify(env)).toBeNull();
    }
    expect(tokenKeyState({ NODE_ENV: "production" })).toBe("missing");
    expect(
      tokenKeyState({ NODE_ENV: "production", MAIL_TOKEN_SECRET: "short" }),
    ).toBe("too-short");
  });

  it("has a fixed key in tests only, so tests need no environment", () => {
    expect(tokenKeyState({ NODE_ENV: "test" })).toBe("test");
    expect(tokenKey({ NODE_ENV: "test" })).not.toBeNull();
    // A real secret still wins in a test that sets one.
    expect(tokenKey({ NODE_ENV: "test", MAIL_TOKEN_SECRET: KEY })).toBe(KEY);
    // And a token signed with the test key means nothing to a real one.
    const testKey = tokenKey({ NODE_ENV: "test" }) ?? "";
    expect(readToken(replyToken(ID, testKey), KEY)).toEqual({
      verified: false,
    });
  });
});
