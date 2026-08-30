/**
 * The outbound edge, rule by rule, plus the tricks.
 *
 * Same discipline as the inbound table: every credential shape gets a case that
 * fires and a case that must not. The must-not cases are all real HALF SOUR
 * copy — prices, SKUs, a handle, a domain — because a scrubber that eats a price
 * is a scrubber somebody turns off.
 *
 * The last block is the one that matters: a redactor is only worth having if it
 * survives the obvious ways round it.
 */

import { describe, expect, it } from "vitest";

import {
  REDACTION_RULES,
  looksLikeEmail,
  redact,
  redactJson,
  redactedRules,
} from "@/lib/agents/boundary";
import { RecordingOutbox, redactingSink } from "@/lib/agents/roster";

interface RuleCase {
  readonly rule: string;
  readonly fires: string;
  /** Real brand or business copy. Must come out byte-identical. */
  readonly quiet: string;
  readonly label: string;
}

const CASES: readonly RuleCase[] = [
  {
    rule: "bearer_token",
    fires: "Authorization: Bearer aGVsbG8tdGhpcy1pcy1sb25nLWVub3VnaA==",
    quiet: "Bearer of bad news: the courier lost it.",
    label: "[redacted:bearer-token]",
  },
  {
    rule: "jwt",
    fires:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    quiet: "eyJ is just base64 for a brace. No dots, no token.",
    label: "[redacted:jwt]",
  },
  {
    rule: "anthropic_key",
    fires: "key=sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF",
    quiet: "SKU HS-01-500 sells at $18.",
    label: "[redacted:anthropic-key]",
  },
  {
    rule: "api_key",
    fires: "sk-proj-AAAABBBBCCCCDDDDEEEE1234",
    quiet: "sk-01 is not a key, it is a shorthand somebody used once.",
    label: "[redacted:api-key]",
  },
  {
    rule: "github_token",
    fires: "ghp_AAAABBBBCCCCDDDDEEEEFFFF1234567890",
    quiet: "ghp_short is not one, and neither is the word github.",
    label: "[redacted:github-token]",
  },
  {
    rule: "slack_token",
    fires: "xoxb-1234567890-ABCDEFGHIJKLMNOP",
    quiet: "xoxo, said the note in the box.",
    label: "[redacted:slack-token]",
  },
  {
    rule: "aws_access_key",
    fires: "AKIAIOSFODNN7EXAMPLE",
    quiet: "AKIALIKEAWORD is thirteen characters and not a key.",
    label: "[redacted:aws-access-key]",
  },
  {
    rule: "email",
    fires: "Reach me on rowan.patel@example.co.nz any time.",
    quiet: "Find us at half-sour.co.nz, or @halfsour on instagram.",
    label: "[redacted:email]",
  },
];

describe("redact", () => {
  it("has a case for every rule on the list", () => {
    expect(CASES.map((entry) => entry.rule).sort()).toEqual(
      REDACTION_RULES.map((rule) => rule.id).sort(),
    );
  });

  it.each(CASES)("$rule scrubs the credential it exists for", (testCase) => {
    expect(redactedRules(testCase.fires)).toContain(testCase.rule);
    expect(redact(testCase.fires)).toContain(testCase.label);
    expect(redact(testCase.fires)).not.toContain(testCase.fires.slice(-16));
  });

  it.each(CASES)("$rule leaves real business copy alone", (testCase) => {
    expect(redact(testCase.quiet)).toBe(testCase.quiet);
  });

  it("keeps the words around the credential, so the founder sees the context", () => {
    const line =
      "The supplier portal rejected us. Their key is sk-ant-api03-AAAABBBBCCCCDDDDEEEE and mine is not.";
    const out = redact(line);
    expect(out).toContain("The supplier portal rejected us.");
    expect(out).toContain("and mine is not.");
    expect(out).toContain("[redacted:anthropic-key]");
  });
});

describe("the obvious ways round it", () => {
  it("cannot be hidden inside a URL or a query string", () => {
    const out = redact(
      "https://api.example.dev/v1?key=sk-ant-api03-AAAABBBBCCCCDDDD",
    );
    expect(out).not.toContain("sk-ant");
  });

  it("cannot be hidden inside quotes, brackets or JSON punctuation", () => {
    for (const wrapped of [
      '{"apiKey":"sk-ant-api03-AAAABBBBCCCCDDDD"}',
      "'sk-ant-api03-AAAABBBBCCCCDDDD'",
      "<sk-ant-api03-AAAABBBBCCCCDDDD>",
      "(sk-ant-api03-AAAABBBBCCCCDDDD)",
    ]) {
      expect(redact(wrapped)).not.toContain("sk-ant-api03");
    }
  });

  it("cannot be hidden by casing the header differently", () => {
    for (const header of [
      "bearer aGVsbG8tdGhpcy1pcy1sb25nLWVub3VnaA==",
      "BEARER aGVsbG8tdGhpcy1pcy1sb25nLWVub3VnaA==",
      "BeArEr aGVsbG8tdGhpcy1pcy1sb25nLWVub3VnaA==",
    ]) {
      expect(redact(header)).toBe("[redacted:bearer-token]");
    }
  });

  it("cannot be hidden by putting the token on the next line", () => {
    const out = redact("Authorization: Bearer\n  aGVsbG8tdGhpcy1pcy1sb25n");
    expect(out).not.toContain("aGVsbG8");
  });

  it("cannot be hidden by repeating it, or by mixing several kinds", () => {
    const out = redact(
      [
        "sk-ant-api03-AAAABBBBCCCCDDDD",
        "ghp_AAAABBBBCCCCDDDDEEEEFFFF1234567890",
        "sk-ant-api03-AAAABBBBCCCCDDDD",
        "AKIAIOSFODNN7EXAMPLE",
        "rowan@example.co.nz",
      ].join(" | "),
    );
    expect(out).not.toMatch(/sk-ant|ghp_|AKIA|@example/);
    expect(out.split("[redacted:anthropic-key]")).toHaveLength(3);
  });

  it("cannot be hidden inside a nested payload", () => {
    const payload = {
      subject: "Restock",
      meta: { retries: [{ error: "401 for sk-ant-api03-AAAABBBBCCCCDDDD" }] },
    };
    expect(JSON.stringify(redactJson(payload))).not.toContain("sk-ant");
    expect(JSON.stringify(redactJson(payload))).toContain("Restock");
  });

  it("is idempotent, so a second pass cannot mangle the first", () => {
    for (const testCase of CASES) {
      expect(redact(redact(testCase.fires))).toBe(redact(testCase.fires));
    }
  });

  it("cannot be defeated by putting a key in the exempt routing field", () => {
    // `allow` only honours values that are themselves a bare address.
    const out = redact("key sk-ant-api03-AAAABBBBCCCCDDDD here", {
      allow: ["sk-ant-api03-AAAABBBBCCCCDDDD"],
    });
    expect(out).not.toContain("sk-ant");
    expect(looksLikeEmail("sk-ant-api03-AAAABBBBCCCCDDDD")).toBe(false);
  });
});

describe("the recipient of a send stays legible", () => {
  it("keeps the address the entry is for and scrubs every other one", () => {
    const out = redact(
      "To rowan@example.co.nz. Our best customer is dana@example.com, tell her too.",
      { allow: ["rowan@example.co.nz"] },
    );
    expect(out).toContain("rowan@example.co.nz");
    expect(out).not.toContain("dana@example.com");
    expect(out).toContain("[redacted:email]");
  });
});

describe("redactingSink", () => {
  const at = new Date("2026-08-30T09:00:00.000Z");

  it("scrubs a credential out of a draft before it is recorded", async () => {
    const recorder = new RecordingOutbox();
    const sink = redactingSink(recorder);

    await sink.write(
      {
        kind: "campaign_email",
        reference: "restock-august",
        summary: "Restock campaign",
        payload: {
          subject: "Back in stock",
          body: "Debug note from the API: sk-ant-api03-AAAABBBBCCCCDDDD failed.",
        },
      },
      at,
    );

    const entry = recorder.entries()[0];
    expect(String(entry?.payload["body"])).toContain(
      "[redacted:anthropic-key]",
    );
    expect(JSON.stringify(recorder.entries())).not.toContain("sk-ant");
  });

  it("keeps the recipient but scrubs a third party's address from the body", async () => {
    const recorder = new RecordingOutbox();
    const sink = redactingSink(recorder);

    await sink.write(
      {
        kind: "customer_reply",
        reference: "rev_9",
        summary: "Reply to rowan@example.co.nz",
        payload: {
          to: "rowan@example.co.nz",
          subject: "About your order",
          body: "Dana (dana@example.com) had the same trouble last week.",
        },
      },
      at,
    );

    const entry = recorder.entries()[0];
    // Deliverable: a real DraftSink can still address this.
    expect(entry?.payload["to"]).toBe("rowan@example.co.nz");
    expect(entry?.summary).toBe("Reply to rowan@example.co.nz");
    // And the other customer's address never leaves with it.
    expect(String(entry?.payload["body"])).not.toContain("dana@example.com");
    expect(String(entry?.payload["body"])).toContain("[redacted:email]");
  });

  it("leaves an entry with nothing to scrub exactly as it was", async () => {
    const recorder = new RecordingOutbox();
    const sink = redactingSink(recorder);
    const payload = { sku: "HS-01-500", fromCents: 1800, toCents: 1900 };

    await sink.write(
      {
        kind: "price_change",
        reference: "HS-01-500",
        summary: "HS-01-500 NZ$18.00 to NZ$19.00",
        payload,
        amountCents: 100,
      },
      at,
    );

    const entry = recorder.entries()[0];
    expect(entry?.payload).toEqual(payload);
    expect(entry?.summary).toBe("HS-01-500 NZ$18.00 to NZ$19.00");
    expect(entry?.amountCents).toBe(100);
  });
});
