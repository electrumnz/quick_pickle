import { LIST, SIGNUP_PROBLEM, WHOLESALE } from "./copy";
import { joinList, requestSamples } from "./list-actions";
import { SIGNUP_PARAM, SIGNUP_PROBLEM_PARAM, signupSucceeded } from "./list";
import styles from "./site.module.css";
import shop from "@/components/product/shop.module.css";
import { cx } from "@/components/product/cx";

/**
 * The list sign-up and the sample request.
 *
 * A plain `<form>` posting to a Server Action, with one field. No client
 * component, no `useActionState`, no optimistic state — the answer arrives as a
 * redirect carrying a query parameter, which is the same mechanism the buy path
 * uses and the reason both work with JavaScript switched off.
 *
 * The confirmation replaces the form rather than appearing beside it. A form
 * still sitting there after a successful post is an invitation to press it
 * again, and the second press is the one that makes a person wonder whether the
 * first one worked.
 */

export interface SignupState {
  /** `SIGNUP_PARAM` from the query string, or null. */
  readonly signedUp: string | null;
  /** `SIGNUP_PROBLEM_PARAM` from the query string, or null. */
  readonly problem: string | null;
}

export function signupParams(get: (key: string) => string | null): SignupState {
  return {
    signedUp: get(SIGNUP_PARAM),
    problem: get(SIGNUP_PROBLEM_PARAM),
  };
}

function Problem({ code }: { code: string | null }) {
  if (code === null) return null;
  const said = SIGNUP_PROBLEM[code];
  if (said === undefined) return null;
  return (
    <p
      className={cx(styles.said, styles.saidProblem, "text-body-sm")}
      role="alert"
    >
      {said}
    </p>
  );
}

/** "Get told when a batch lands." One field, on the homepage. */
export function JoinTheList({
  state,
  sourcePath,
}: {
  state: SignupState;
  sourcePath: string;
}) {
  if (signupSucceeded(state.signedUp, "list")) {
    return (
      <p className={cx(styles.said, "text-body")} role="status">
        {LIST.done}
      </p>
    );
  }

  return (
    <form action={joinList} className={cx(styles.form)}>
      <input type="hidden" name="sourcePath" value={sourcePath} />
      <Problem code={state.problem} />
      <div>
        <label
          htmlFor="list-email"
          className="text-eyebrow font-mono uppercase"
        >
          {LIST.emailLabel}
        </label>
        <input
          id="list-email"
          className={cx(styles.field)}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          maxLength={254}
          placeholder={LIST.emailPlaceholder}
        />
      </div>
      <button
        type="submit"
        className={cx(shop.button, shop.buttonPrimary, "w-fit")}
      >
        {LIST.submit}
      </button>
      <p className="text-caption">{LIST.privacyLine}</p>
    </form>
  );
}

/** "Ask for two samples." The venue's name and an address. */
export function AskForSamples({
  state,
  sourcePath,
}: {
  state: SignupState;
  sourcePath: string;
}) {
  if (signupSucceeded(state.signedUp, "trade")) {
    return (
      <p className={cx(styles.said, "text-body text-primary")} role="status">
        {WHOLESALE.samplesDone}
      </p>
    );
  }

  return (
    <form action={requestSamples} className={cx(styles.form)}>
      <input type="hidden" name="sourcePath" value={sourcePath} />
      <Problem code={state.problem} />
      <div>
        <label
          htmlFor="trade-venue"
          className="text-eyebrow text-muted font-mono uppercase"
        >
          {WHOLESALE.samplesVenueLabel}
        </label>
        <input
          id="trade-venue"
          className={cx(styles.field)}
          type="text"
          name="venue"
          autoComplete="organization"
          maxLength={200}
          placeholder={WHOLESALE.samplesVenuePlaceholder}
        />
      </div>
      <div>
        <label
          htmlFor="trade-email"
          className="text-eyebrow text-muted font-mono uppercase"
        >
          {WHOLESALE.samplesEmailLabel}
        </label>
        <input
          id="trade-email"
          className={cx(styles.field)}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          maxLength={254}
          placeholder={WHOLESALE.samplesEmailPlaceholder}
        />
      </div>
      <button
        type="submit"
        className={cx(shop.button, shop.buttonPrimary, "w-fit")}
      >
        {WHOLESALE.samplesSubmit}
      </button>
    </form>
  );
}
