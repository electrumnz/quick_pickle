import { count, money } from "@/components/admin/data/format";

/**
 * "What it changed", read out of what the agent wrote down.
 *
 * Every approval carries a `preview` — the agent's own summary of the change,
 * written for a human — and a `payload`, which is the exact call it will make
 * if she says yes. Neither is a fixed shape, because seventeen kinds of
 * decision cannot share one, so this reads both and finds the pairs: a
 * `current` next to a `proposed`, a `from_cents` next to a `to_cents`, a
 * `margin_before` next to a `margin_after`. Those become a real before-and-after
 * line. Everything left over is a plain fact.
 *
 * Nothing is invented. A key with no partner is never guessed into a change,
 * because "$22.00 becomes $23.50" on a screen she trusts has to be true.
 */

export type Change = {
  readonly label: string;
  /** What it is now. Null when this is a fact rather than a change. */
  readonly from: string | null;
  readonly to: string;
  /** Long prose — an email body, a caption — gets its own block. */
  readonly long: boolean;
};

/** The suffix pairs that mean "this was, and this becomes". */
const PAIRS: readonly (readonly [string, string])[] = [
  ["current", "proposed"],
  ["before", "after"],
  ["from", "to"],
  ["was", "now"],
  ["old", "new"],
];

export function readChanges(
  preview: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>,
): readonly Change[] {
  // The preview is the agent's summary written for a person, so it wins when
  // it exists. The payload is only read when there is no preview at all —
  // showing both puts the same change on the screen twice in two dialects.
  const source: Record<string, unknown> =
    Object.keys(preview).length > 0 ? { ...preview } : fromPayload(payload);

  const changes: Change[] = [];
  const used = new Set<string>();

  for (const key of Object.keys(source)) {
    if (used.has(key)) continue;
    const pair = partnerOf(key, source);
    if (pair === null) continue;
    const from = render(key, source[pair.fromKey]);
    const to = render(key, source[pair.toKey]);
    // Half a pair is not a change. Left alone, both halves fall through to the
    // plain-fact list below rather than becoming "something → nothing".
    if (from === null || to === null) continue;
    used.add(key);
    used.add(pair.partner);
    changes.push({
      label: labelFor(pair.subject, key),
      from,
      to,
      long: from.length + to.length > 110,
    });
  }

  for (const [key, value] of Object.entries(source)) {
    if (used.has(key)) continue;
    const shown = render(key, value);
    if (shown === null || shown === "") continue;
    changes.push({
      label: labelFor(key, key),
      from: null,
      to: shown,
      long: shown.length > 110 || shown.includes("\n"),
    });
  }

  return changes;
}

type Partner = {
  readonly partner: string;
  readonly subject: string;
  readonly fromKey: string;
  readonly toKey: string;
};

/**
 * Find the other half of a pair.
 *
 * A key matches when stripping a known prefix or suffix off it leaves a subject
 * that also exists with the opposite word: `from_cents` and `to_cents`,
 * `margin_before` and `margin_after`, bare `current` and bare `proposed`.
 */
function partnerOf(
  key: string,
  source: Readonly<Record<string, unknown>>,
): Partner | null {
  for (const [low, high] of PAIRS) {
    for (const [self, other] of [
      [low, high],
      [high, low],
    ] as const) {
      const subject = strip(key, self);
      if (subject === null) continue;
      const partner = rejoin(key, self, other);
      if (!(partner in source)) continue;
      // Only report the pair once, from its "before" half.
      if (self !== low) return null;
      return {
        partner,
        subject,
        fromKey: key,
        toKey: partner,
      };
    }
  }
  return null;
}

function strip(key: string, word: string): string | null {
  if (key === word) return "";
  if (key.startsWith(`${word}_`)) return key.slice(word.length + 1);
  if (key.endsWith(`_${word}`)) return key.slice(0, -(word.length + 1));
  return null;
}

function rejoin(key: string, self: string, other: string): string {
  if (key === self) return other;
  if (key.startsWith(`${self}_`))
    return `${other}_${key.slice(self.length + 1)}`;
  return `${key.slice(0, -(self.length + 1))}_${other}`;
}

/**
 * What is left of a payload once the machinery is taken out.
 *
 * `tool`, `effect` and `agentSlug` are said in words elsewhere on the card, and
 * `arguments` is the nested object that actually describes the action.
 */
function fromPayload(
  payload: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const inner = payload["arguments"];
  const base: Record<string, unknown> =
    typeof inner === "object" && inner !== null && !Array.isArray(inner)
      ? { ...(inner as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(payload)) {
    if (["tool", "effect", "agentSlug", "arguments"].includes(key)) continue;
    if (!(key in base)) base[key] = value;
  }
  return base;
}

const NICE: Readonly<Record<string, string>> = {
  sku: "SKU",
  to: "To",
  cc: "Copied to",
  url: "Link",
  id: "Id",
  po: "Purchase order",
};

function labelFor(subject: string, fallbackKey: string): string {
  // A bare `current`/`proposed` pair names no subject at all. Guessing one
  // would put a word on the screen the agent never wrote.
  if (subject === "" && subject !== fallbackKey) return "The change";
  if (subject === "cents") return "Amount";
  const base = (subject === "" ? fallbackKey : subject)
    .replace(/_cents$/, "")
    .replace(/_/g, " ")
    .trim();
  const known = NICE[base.toLowerCase()];
  if (known !== undefined) return known;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** A JSON value as the founder would read it. Money stays integer cents. */
function render(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return key.endsWith("_cents") || key === "cents"
      ? money(Math.round(value))
      : count(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => render(key, entry))
      .filter((entry): entry is string => entry !== null);
    return parts.length === 0 ? null : parts.join(", ");
  }
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .map(([inner, entry]) => {
        const shown = render(inner, entry);
        return shown === null ? null : `${labelFor(inner, inner)}: ${shown}`;
      })
      .filter((entry): entry is string => entry !== null);
    return parts.length === 0 ? null : parts.join(" · ");
  }
  return null;
}
