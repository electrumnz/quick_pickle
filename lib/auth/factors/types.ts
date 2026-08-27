/**
 * The second-factor seam.
 *
 * HALF SOUR ships today with one credential: a password the founder chose,
 * knowingly, as the only thing between the internet and her business. She has
 * said she wants to harden that later. This file is the difference between
 * "later" meaning a refactor and "later" meaning an afternoon.
 *
 * The login flow does not check a password and then optionally consider some
 * future extension. It verifies the password, then walks a configured list of
 * {@link AuthFactor}s and refuses to mint a session unless every one of them is
 * satisfied. That walk happens today, in production, on every sign-in — with
 * exactly one factor registered, {@link NoopSecondFactor}, which is enrolled
 * for nobody and therefore satisfied for everybody.
 *
 * Adding a passkey means:
 *   1. write `PasskeyFactor implements AuthFactor`
 *   2. add it to the array in `./registry`
 * and nothing else. No change to `login.ts`, the route handler, the session
 * layer, the throttle, or the form — the form already renders whatever fields
 * a challenging factor declares.
 */

/** A field a factor needs the visitor to fill in to answer its challenge. */
export type FactorField = {
  /** Form field name. Must not collide with the password or CSRF fields. */
  readonly name: string;
  /** Visible label. Rendered by the login form as-is. */
  readonly label: string;
  /** Input type. `otp` renders a numeric one-time-code input. */
  readonly type: "text" | "otp" | "password";
  /** `autocomplete` attribute, so password managers behave. */
  readonly autoComplete?: string;
  /** Expected length, when the factor has a fixed-width code. */
  readonly maxLength?: number;
};

/** What a factor wants from the visitor before it will decide. */
export type FactorChallenge =
  | { readonly kind: "none" }
  | {
      readonly kind: "fields";
      readonly prompt: string;
      readonly fields: readonly FactorField[];
    };

/** A factor's verdict on one sign-in attempt. */
export type FactorResult =
  /** Nothing more is required of this factor. */
  | { readonly kind: "satisfied" }
  /** The visitor must supply something first; re-render the form with these fields. */
  | { readonly kind: "challenge"; readonly challenge: FactorChallenge }
  /** The visitor answered, and the answer was wrong. */
  | { readonly kind: "failed"; readonly detail: string };

/**
 * Everything a factor is allowed to know about the attempt.
 *
 * Note what is absent: the password, the password hash, the session secret and
 * the raw request. A factor cannot read the primary credential, and cannot
 * reach around the flow to set a cookie of its own.
 */
export type FactorContext = {
  /** The operator the password attempt resolved to. */
  readonly operator: { readonly id: string; readonly email: string };
  /** Fields submitted with the login form, password and CSRF token removed. */
  readonly submitted: ReadonlyMap<string, string>;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string;
  readonly now: Date;
};

/**
 * One authentication factor.
 *
 * Implementations must be side-effect free in {@link isEnrolled} and
 * {@link challenge}; only {@link verify} may consume a one-time code or bump a
 * counter, and it is called at most once per sign-in attempt.
 */
export interface AuthFactor {
  /** Stable machine id, recorded in `audit_log`. */
  readonly id: string;
  /** Human label for the login form and the audit trail. */
  readonly label: string;
  /** Whether this operator has this factor set up. Unenrolled factors are skipped. */
  isEnrolled(context: FactorContext): Promise<boolean>;
  /** What to ask the visitor for. Called only when enrolled. */
  challenge(context: FactorContext): Promise<FactorChallenge>;
  /** Decide, given whatever the visitor submitted. Called only when enrolled. */
  verify(context: FactorContext): Promise<FactorResult>;
}

/** The outcome of walking the whole chain. */
export type FactorChainResult =
  | { readonly kind: "satisfied"; readonly factorIds: readonly string[] }
  | {
      readonly kind: "challenge";
      readonly factorId: string;
      readonly challenge: FactorChallenge;
    }
  | {
      readonly kind: "failed";
      readonly factorId: string;
      readonly detail: string;
    };
