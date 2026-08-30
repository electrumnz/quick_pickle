/**
 * The outbound edge: what a write carries out of the runtime.
 *
 * Today this costs nothing, because the outbox delivers nothing — every
 * approved action is recorded with `delivered: false`. It stops being free the
 * moment `DraftSink` is implemented against a real channel, which the outbox's
 * own doc comment describes as a one-interface change. The scrubber belongs in
 * place *before* that channel exists, not after, so a real sink inherits it
 * rather than having to remember it.
 *
 * Two things are being protected. Credentials, obviously: an agent that read a
 * key out of an error string must not be able to write it into a draft the
 * founder later approves. And addresses, less obviously — ours is a legitimate
 * sender, but a campaign draft that quotes one customer's email back into a
 * public post is the mistake that actually happens.
 *
 * Which is why the recipient of a send is *not* redacted: see {@link redact}'s
 * `allow` option and `redactingSink` in `lib/agents/roster/outbox.ts`. An
 * address the entry is addressed to stays legible; every other address in the
 * same entry does not.
 */

import type { JsonObject, JsonValue } from "../json";

/** One credential shape, its label, and why it is on the list. */
export interface RedactionRule {
  /** Stable id, used by the tests. */
  readonly id: string;
  readonly pattern: RegExp;
  /** What replaces a match, e.g. `[redacted:anthropic-key]`. */
  readonly label: string;
  readonly why: string;
}

function marker(label: string): string {
  return `[redacted:${label}]`;
}

/**
 * The pattern list, in application order.
 *
 * `bearer_token` runs first on purpose: `Bearer sk-ant-…` should collapse to one
 * clean marker rather than a marker inside a header. `anthropic_key` runs before
 * the generic `api_key` so the more specific label wins. Nothing here matches
 * the `[redacted:…]` text it produces, which is what makes redaction idempotent.
 */
export const REDACTION_RULES: readonly RedactionRule[] = [
  {
    id: "bearer_token",
    // \s+ rather than a space: a token split onto the next line is still a token.
    pattern: /\bbearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
    label: "bearer-token",
    why: "An Authorization header pasted into a draft, in any casing.",
  },
  {
    id: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    label: "jwt",
    why: "A JWT by its three-segment shape; the header always base64s to eyJ.",
  },
  {
    id: "anthropic_key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
    label: "anthropic-key",
    why: "The key this runtime itself calls the model with.",
  },
  {
    id: "api_key",
    pattern: /\bsk-[A-Za-z0-9_-]{16,}/g,
    label: "api-key",
    why: "The generic sk- provider key shape.",
  },
  {
    id: "github_token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
    label: "github-token",
    why: "GitHub personal, OAuth, user, server and refresh tokens.",
  },
  {
    id: "slack_token",
    pattern: /\bxox[bapes]-[A-Za-z0-9-]{10,}/g,
    label: "slack-token",
    why: "Slack bot, app, user and legacy tokens.",
  },
  {
    id: "aws_access_key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    label: "aws-access-key",
    why: "An AWS access key id: AKIA plus exactly sixteen uppercase characters.",
  },
  {
    id: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    label: "email",
    why: "A bare address, so one customer's is never quoted into another's copy.",
  },
];

/** The email rule on its own, for callers deciding what may be exempted. */
const EMAIL_RULE = REDACTION_RULES.find((rule) => rule.id === "email");

/** True when a string is exactly one email address and nothing else. */
export function looksLikeEmail(value: string): boolean {
  if (EMAIL_RULE === undefined) {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.replace(EMAIL_RULE.pattern, "") === "";
}

export interface RedactOptions {
  /**
   * Literal strings to leave intact — the recipient of a send, and nothing
   * else. Only values that are themselves a bare email address are honoured, so
   * a caller cannot exempt a credential by putting it in a routing field.
   */
  readonly allow?: readonly string[];
}

/** A sentinel no rule matches, used to hold an exempted value aside. */
function holdToken(index: number): string {
  return `{{allow-${String(index)}}}`;
}

function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scrub credential-shaped strings out of text.
 *
 * Idempotent, and safe to run over text that has already been redacted.
 */
export function redact(text: string, options: RedactOptions = {}): string {
  const allowed = (options.allow ?? []).filter(
    (value) => value.length > 0 && looksLikeEmail(value),
  );

  let out = text;
  allowed.forEach((value, index) => {
    out = out.replace(new RegExp(escapeLiteral(value), "g"), holdToken(index));
  });

  for (const rule of REDACTION_RULES) {
    out = out.replace(rule.pattern, marker(rule.label));
  }

  allowed.forEach((value, index) => {
    out = out.replace(new RegExp(escapeLiteral(holdToken(index)), "g"), value);
  });
  return out;
}

/** Redact every string leaf of a JSON value, leaving its shape untouched. */
export function redactJson(
  value: JsonValue,
  options: RedactOptions = {},
): JsonValue {
  if (typeof value === "string") {
    return redact(value, options);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactJson(entry, options));
  }
  if (value !== null && typeof value === "object") {
    const out: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactJson(entry, options);
    }
    return out;
  }
  return value;
}

/** Which rules actually fired. Used by the tests and the evidence runs. */
export function redactedRules(text: string): readonly string[] {
  return REDACTION_RULES.filter(
    (rule) => text.replace(rule.pattern, marker(rule.label)) !== text,
  ).map((rule) => rule.id);
}
