import type {
  AuthFactor,
  FactorChallenge,
  FactorContext,
  FactorField,
} from "./types";

/**
 * Turn a factor's challenge into fields the login form can render.
 *
 * This is the last piece of the seam. The login form renders the password field
 * and then whatever fields the challenging factor declares, so a factor added
 * later brings its own UI with it: a passkey factor that needs an assertion
 * blob, or a TOTP factor that needs six digits, describes its input here and
 * the form obliges without a line changing in `page.tsx`.
 */
export async function challengeFieldsFor(
  factors: readonly AuthFactor[],
  factorId: string | null,
  context: FactorContext,
): Promise<{
  readonly prompt: string;
  readonly fields: readonly FactorField[];
} | null> {
  if (factorId === null || factorId === "") return null;
  const factor = factors.find((candidate) => candidate.id === factorId);
  if (factor === undefined) return null;
  if (!(await factor.isEnrolled(context))) return null;

  const challenge: FactorChallenge = await factor.challenge(context);
  if (challenge.kind !== "fields" || challenge.fields.length === 0) return null;
  return { prompt: challenge.prompt, fields: challenge.fields };
}
