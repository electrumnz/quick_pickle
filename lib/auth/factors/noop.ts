import type {
  AuthFactor,
  FactorChallenge,
  FactorContext,
  FactorResult,
} from "./types";

/**
 * The only factor registered today.
 *
 * It is enrolled for nobody, so the chain walks past it and the password alone
 * opens the door — which is precisely what the founder asked for. Its job is
 * not to add security; its job is to make the chain a live code path that runs
 * on every sign-in, so that the day a real factor is added it drops into
 * machinery that has been exercised in production all along rather than into a
 * comment that said "add 2FA here".
 */
export class NoopSecondFactor implements AuthFactor {
  readonly id = "noop";
  readonly label = "No second factor";

  isEnrolled(_context: FactorContext): Promise<boolean> {
    return Promise.resolve(false);
  }

  challenge(_context: FactorContext): Promise<FactorChallenge> {
    return Promise.resolve({ kind: "none" });
  }

  verify(_context: FactorContext): Promise<FactorResult> {
    return Promise.resolve({ kind: "satisfied" });
  }
}

export const noopSecondFactor = new NoopSecondFactor();
