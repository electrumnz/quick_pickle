/** Types for rules.mjs, for the app code that checks words as they leave. */

export type CopySeverity = "banned" | "restricted";
export type CopyReach = "every-surface" | "consumer-only";

export type CopyRule = {
  readonly id: string;
  readonly severity: CopySeverity;
  readonly applies: CopyReach;
  readonly re: RegExp;
  readonly why: string;
  readonly src: string;
};

export type CopyFinding = {
  /** The rule's id, as in legal/COPY-RULES.md. */
  readonly id: string;
  readonly severity: CopySeverity;
  /** The words that matched, as written. */
  readonly match: string;
  readonly index: number;
  readonly why: string;
  readonly source: string;
};

export const BANNED: "banned";
export const RESTRICTED: "restricted";
export const EVERY_SURFACE: "every-surface";
export const CONSUMER_ONLY: "consumer-only";

export const RULES: readonly CopyRule[];

export const TERMS_OF_ART: readonly {
  readonly id: string;
  readonly rules: readonly string[];
  readonly re: RegExp;
  readonly why: string;
}[];

export function termSpansFor(
  ruleId: string,
  text: string,
  cache: Map<string, unknown>,
): { readonly start: number; readonly end: number }[];

/** Every rule, applied to one piece of finished text. */
export function scanText(text: string): CopyFinding[];
