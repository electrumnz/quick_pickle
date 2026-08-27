import { noopSecondFactor } from "./noop";
import type { AuthFactor, FactorChainResult, FactorContext } from "./types";

/**
 * The configured factor chain.
 *
 * Today: one pass-through factor. To require a passkey or a TOTP code tomorrow,
 * write the implementation and add it to this array. Order is the order the
 * visitor is challenged in.
 */
export const REGISTERED_FACTORS: readonly AuthFactor[] = [noopSecondFactor];

/**
 * Walk the chain.
 *
 * Every enrolled factor must return `satisfied` before a session is minted. The
 * first factor that wants something stops the walk and its challenge is what
 * the login form re-renders; the first that refuses stops the walk and the
 * sign-in fails. Unenrolled factors are skipped without being asked to verify,
 * which is what lets a factor be deployed before it is turned on for anyone.
 */
export async function runFactorChain(
  factors: readonly AuthFactor[],
  context: FactorContext,
): Promise<FactorChainResult> {
  const satisfied: string[] = [];

  for (const factor of factors) {
    if (!(await factor.isEnrolled(context))) continue;

    const result = await factor.verify(context);
    if (result.kind === "failed") {
      return { kind: "failed", factorId: factor.id, detail: result.detail };
    }
    if (result.kind === "challenge") {
      const challenge =
        result.challenge.kind === "none"
          ? await factor.challenge(context)
          : result.challenge;
      return { kind: "challenge", factorId: factor.id, challenge };
    }
    satisfied.push(factor.id);
  }

  return { kind: "satisfied", factorIds: satisfied };
}
